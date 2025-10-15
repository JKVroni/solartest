# main/views.py
from django.shortcuts import render
from django.http import JsonResponse
from django.conf import settings
import os
import requests
import urllib3

# 로컬/사내망 SSL MITM 환경 경고 억제 (개발 편의를 위해서만)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

VWORLD_BASE = "https://api.vworld.kr/req/address"

def _get_vworld_key():
    # settings에 없으면 환경변수도 체크, 마지막으로 제공한 기본키 사용
    return (
        getattr(settings, 'VWORLD_API_KEY', '')
        or getattr(settings, 'VWORLD_KEY', '')
        or os.environ.get('VWORLD_API_KEY')
        or os.environ.get('VWORLD_KEY')
        or "2999371B-F71D-32DA-85C3-ED9AB3C48403"
    )

def _req(params: dict, insecure: bool = False):
    """VWorld 요청 공통 함수 (사내망 SSL 문제시 verify=False로 재시도 가능)."""
    return requests.get(VWORLD_BASE, params=params, timeout=7, verify=not insecure)

# ──────────────────────────────────────────────────────────────────────────────
# View: 맵 템플릿
# ──────────────────────────────────────────────────────────────────────────────
def map_view(request):
    return render(request, 'main/map.html')

# ──────────────────────────────────────────────────────────────────────────────
# 호환용(기존): 주소 검색 단일 엔드포인트
#  - 프런트가 /api/vworld/getCoord로 바뀌었지만, 기존 호출이 있을 수 있어 유지
# ──────────────────────────────────────────────────────────────────────────────
def search_address(request):
    q = request.GET.get('q', '').strip()
    if not q:
        return JsonResponse({'error': 'empty_query'}, status=400)

    api_key = _get_vworld_key()
    if not api_key:
        return JsonResponse({'error': 'missing_api_key'}, status=500)

    common = {
        "service": "address",
        "request": "getCoord",
        "version": "2.0",
        "crs": "EPSG:4326",
        "format": "json",
        "refine": "true",
        "simple": "false",
        "key": api_key,
        "address": q,
    }

    def call(type_, insecure=False):
        params = {**common, "type": type_}
        return _req(params, insecure=insecure)

    try:
        insecure = False
        try:
            r = call("road")
        except requests.exceptions.SSLError:
            insecure = True
            r = call("road", insecure=True)

        data = r.json()
        if data.get('response', {}).get('status') != 'OK':
            r2 = call("parcel", insecure=insecure)
            data2 = r2.json()
            if data2.get('response', {}).get('status') != 'OK':
                return JsonResponse({'error': 'not_found', 'provider': data2}, status=404)
            data = data2

        res = data['response']['result']
        item = res[0] if isinstance(res, list) else res
        pt = item.get('point')
        if not pt:
            return JsonResponse({'error': 'no_point_in_result', 'provider': item}, status=500)

        return JsonResponse({
            'x': float(pt['x']), 'y': float(pt['y']),
            'label': item.get('text', q),
            'insecure': insecure,  # 개발 중 참고용
        })
    except requests.exceptions.Timeout:
        return JsonResponse({'error': 'timeout'}, status=504)
    except requests.exceptions.SSLError as e:
        return JsonResponse({'error': 'ssl_error', 'detail': str(e)}, status=502)
    except Exception as e:
        return JsonResponse({'error': 'internal', 'detail': str(e)}, status=500)

# ──────────────────────────────────────────────────────────────────────────────
# 신규(핵심) 1: /api/vworld/getCoord  → 프런트의 doSearch()가 호출
#  - VWorld 응답을 "있는 그대로" 리턴 (프런트에서 그대로 파싱)
#  - type=ROAD | PARCEL (기본 ROAD)
# ──────────────────────────────────────────────────────────────────────────────
def vworld_get_coord(request):
    q = request.GET.get('q', '').strip()
    type_ = request.GET.get('type', 'ROAD').upper()  # ROAD | PARCEL
    if not q:
        return JsonResponse({'error': 'empty_query'}, status=400)

    api_key = _get_vworld_key()
    params = {
        'service': 'address', 'request': 'getCoord', 'version': '2.0',
        'crs': 'EPSG:4326', 'format': 'json',
        'type': type_, 'address': q, 'key': api_key,
        'refine': 'true', 'simple': 'false',
    }

    try:
        insecure = False
        try:
            r = _req(params, insecure=False)
        except requests.exceptions.SSLError:
            insecure = True
            r = _req(params, insecure=True)

        # VWorld 원본 JSON 그대로 전달
        return JsonResponse(r.json(), safe=False, status=r.status_code)
    except requests.exceptions.Timeout:
        return JsonResponse({'error': 'timeout'}, status=504)
    except requests.exceptions.SSLError as e:
        return JsonResponse({'error': 'ssl_error', 'detail': str(e)}, status=502)
    except Exception as e:
        return JsonResponse({'error': 'internal', 'detail': str(e)}, status=500)

# ──────────────────────────────────────────────────────────────────────────────
# 신규(핵심) 2: /api/vworld/getAddress  → 프런트의 reverseGeocodeVWorld()가 호출
#  - 지번(parcel) / 도로명(road) 두 번 조회해서 축약 JSON으로 반환
# ──────────────────────────────────────────────────────────────────────────────
def vworld_get_address(request):
    lat = request.GET.get('lat')
    lng = request.GET.get('lng')
    if not lat or not lng:
        return JsonResponse({'error': 'missing lat/lng'}, status=400)

    api_key = _get_vworld_key()

    p_common = {
        'service': 'address', 'request': 'getAddress', 'version': '2.0',
        'crs': 'epsg:4326', 'point': f"{lng},{lat}",
        'format': 'json', 'key': api_key,
    }
    p_parcel = {**p_common, 'type': 'parcel'}
    p_road   = {**p_common, 'type': 'road'}

    try:
        insecure = False
        try:
            j = _req(p_parcel, insecure=False).json()
            r = _req(p_road,   insecure=False).json()
        except requests.exceptions.SSLError:
            insecure = True
            j = _req(p_parcel, insecure=True).json()
            r = _req(p_road,   insecure=True).json()

        def pick_text(obj):
            res = obj.get('response', {}).get('result')
            if isinstance(res, list):
                return res[0].get('text') if res else None
            return res.get('text') if isinstance(res, dict) else None

        jibun = pick_text(j)
        road  = pick_text(r)
        return JsonResponse({'jibun': jibun, 'road': road, 'insecure': insecure}, status=200)

    except requests.exceptions.Timeout:
        return JsonResponse({'error': 'timeout'}, status=504)
    except requests.exceptions.SSLError as e:
        return JsonResponse({'error': 'ssl_error', 'detail': str(e)}, status=502)
    except Exception as e:
        return JsonResponse({'error': 'internal', 'detail': str(e)}, status=500)
