from django.contrib import admin
from .models import Reference, Job, ReferenceUpload, UploadedReference

admin.site.register(Reference)
admin.site.register(Job)
admin.site.register(ReferenceUpload)
admin.site.register(UploadedReference)

# Register your models here.
