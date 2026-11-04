from rest_framework import serializers
from .models import Reference, ReferenceHistory


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