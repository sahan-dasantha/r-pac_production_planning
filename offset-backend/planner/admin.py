from django.contrib import admin
from .models import Reference, Job, JobLog, ReferenceUpload, UploadedReference

admin.site.register(Reference)
admin.site.register(Job)
admin.site.register(JobLog)
admin.site.register(ReferenceUpload)
admin.site.register(UploadedReference)


# Register your models here.
