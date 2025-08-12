from django.contrib.gis.db import models
#이 import과정 중요합니다. PostgreSQL을 사용하기 위해서 django.contrib.gis.db에서 models를 가져와야 합니다.

class Jimok(models.Model):
    gid = models.IntegerField(primary_key=True)
    sgg_oid = models.IntegerField()
    jibun = models.CharField(max_length=255, blank=True, null=True)
    bchk = models.CharField(max_length=255, blank=True, null=True)
    pnu = models.CharField(max_length=255, blank=True, null=True)
    col_adm_se = models.CharField(max_length=255, blank=True, null=True)
    geom = models.MultiPolygonField(srid=4326)
    
    class Meta:
        db_table = 'filter"."jimok'  # 스키마 명시적 지정
        managed = False  # 마이그레이션으로 만들지 않도록ㅣ