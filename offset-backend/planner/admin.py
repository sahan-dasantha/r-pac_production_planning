from django.contrib import admin

from .models import Job, JobLog, Reference, ReferenceHistory, SalesOrder, UploadBatch


@admin.register(Reference)
class ReferenceAdmin(admin.ModelAdmin):
    list_display = ["name", "ups", "colours", "sides", "default_machine", "updated_at"]
    search_fields = ["name"]


@admin.register(SalesOrder)
class SalesOrderAdmin(admin.ModelAdmin):
    list_display = ["so_number", "reference_name", "customer", "quantity", "status", "batch"]
    list_filter = ["status", "batch"]
    search_fields = ["so_number", "reference_name", "customer"]


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ["sales_order", "machine", "ups", "total_clicks", "created_by", "created_at"]
    search_fields = ["sales_order__so_number", "reference_name"]


admin.site.register(UploadBatch)
admin.site.register(ReferenceHistory)
admin.site.register(JobLog)