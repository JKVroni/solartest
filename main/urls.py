from django.urls import path
from . import views

urlpatterns = [
    path('', views.map_view, name='map'),
    path('search_address/', views.search_address, name='search_address'),
    path('api/vworld/getCoord', views.vworld_get_coord),
    path('api/vworld/getAddress', views.vworld_get_address),
]