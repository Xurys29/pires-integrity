from django.contrib import admin

from .models import Asset, Client, Company, System, Unit


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ("name", "active")
    search_fields = ("name", "registration_number")


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ("name", "company", "active")
    list_filter = ("company", "active")
    search_fields = ("name", "registration_number")


@admin.register(Unit)
class UnitAdmin(admin.ModelAdmin):
    list_display = ("name", "client", "company", "active")
    list_filter = ("company", "active")
    search_fields = ("name", "client__name")
    autocomplete_fields = ("company", "client")


@admin.register(System)
class SystemAdmin(admin.ModelAdmin):
    list_display = ("name", "unit", "company", "active")
    list_filter = ("company", "active")
    search_fields = ("name", "unit__name")
    autocomplete_fields = ("company", "unit")


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ("tag", "asset_type", "system", "company", "active")
    list_filter = ("company", "asset_type", "active")
    search_fields = ("tag", "description", "system__name")
    autocomplete_fields = ("company", "system")