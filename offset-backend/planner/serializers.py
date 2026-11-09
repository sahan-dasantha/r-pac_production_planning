from rest_framework import serializers
from .models import Reference, ReferenceHistory, Job


class ReferenceSerializer(serializers.ModelSerializer):
    updated_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = Reference
        fields = ["id", "name", "ups", "colours", "sides",
                  "default_machine", "updated_at", "updated_by"]

    def validate_name(self, value):
        return " ".join(value.split())  # trim and collapse extra spaces


class ReferenceHistorySerializer(serializers.ModelSerializer):
    changed_by = serializers.StringRelatedField()

    class Meta:
        model = ReferenceHistory
        fields = ["changes", "changed_by", "changed_at"]

class JobSerializer(serializers.ModelSerializer):
    # Show the username instead of the user's numeric id.
    created_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = Job
        fields = [
            "id",
            # --- sent by the Home form ---
            "reference",        # the reference's id (from the dropdown)
            "date",             # format YYYY-MM-DD
            "quantity",
            "machine",
            # --- filled in by the backend (the frontend only reads them) ---
            "reference_name",
            "ups", "colours", "sides",
            "impressions", "total_impressions", "total_clicks",
            "created_by", "created_at",
        ]
        # Even if the frontend sends these, Django ignores them.
        read_only_fields = [
            "reference_name", "ups", "colours", "sides",
            "impressions", "total_impressions", "total_clicks",
            "created_by", "created_at",
        ]
        def validate_reference(self, value):
        # When editing a saved job (self.instance exists), the reference
        # must stay the same. Creating a new job is not affected.
            if self.instance is not None and value != self.instance.reference:
                raise serializers.ValidationError(
                "The reference of a saved job cannot be changed. "
                "Delete the job and add a new one."
            )
            return value    
                