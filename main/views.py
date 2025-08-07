from django.shortcuts import render

# Create your views here.
def map_view(request):
    return render(request, 'main/map.html')