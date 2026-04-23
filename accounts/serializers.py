from django.contrib.auth.models import Group
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from accounts import roles
from accounts.models import User


class UserSerializer(serializers.ModelSerializer):
    group_names = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "first_name",
            "last_name",
            "campus_id",
            "is_staff",
            "date_joined",
            "group_names",
        )
        read_only_fields = fields

    def get_group_names(self, obj: User) -> list[str]:
        return list(obj.groups.order_by("name").values_list("name", flat=True))


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True, min_length=8)
    role = serializers.ChoiceField(choices=roles.ROLE_CHOICES, write_only=True)

    class Meta:
        model = User
        fields = (
            "email",
            "password",
            "password_confirm",
            "first_name",
            "last_name",
            "campus_id",
            "role",
        )

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": "Passwords do not match."})
        email = attrs.get("email", "").lower().strip()
        attrs["email"] = email
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError(
                {"email": "This email is already registered."},
            )
        return attrs

    def create(self, validated_data):
        role = validated_data.pop("role")
        validated_data.pop("password_confirm", None)
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.is_active = True
        user.save()
        group, _ = Group.objects.get_or_create(name=role)
        user.groups.add(group)
        return user


class CampusTokenObtainPairSerializer(TokenObtainPairSerializer):
    """JWT pair serializer using email + password (email is USERNAME_FIELD)."""

    username_field = User.USERNAME_FIELD

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["email"] = user.email
        token["groups"] = list(user.groups.order_by("name").values_list("name", flat=True))
        return token
