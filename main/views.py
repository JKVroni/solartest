from django.shortcuts import render
from django.http import JsonResponse
from django.conf import settings
import requests, urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def map_view(request):
    return render(request, 'main/map.html')

def search_address(request):
    q = request.GET.get('q', '').strip()
    if not q:
        return JsonResponse({'error': 'empty_query'}, status=400)

    api_key = getattr(settings, 'VWORLD_API_KEY', '')
    if not api_key:
        return JsonResponse({'error': 'missing_api_key'}, status=500)

    base_url = "https://api.vworld.kr/req/address"
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
        return requests.get(base_url, params=params, timeout=7, verify=not insecure)

    try:
        insecure = False
        try:
            r = call("road")
        except requests.exceptions.SSLError:
            # 회사망 등의 SSL MITM 환경: 개발용으로만 무검증 재시도
            insecure = True
            r = call("road", insecure=True)

        data = r.json()
        if data.get('response', {}).get('status') != 'OK':
            # parcel로 재시도 (같은 insecure 플래그 유지)
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