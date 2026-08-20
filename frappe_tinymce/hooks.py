from . import __version__ as app_version

app_name = "frappe_tinymce"
app_title = "Frappe tineMCE"
app_publisher = "Shridhar Patil"
app_description = "Frappe app to replace default text editor with tinyMCE"
app_icon = "octicon octicon-file-directory"
app_color = "grey"
app_email = "shridharpatil2792@gmail.com"
app_license = "MIT"

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
app_include_css = "frappe_tinymce.bundle.css"

# TinyMCE is served from this app (public/tinymce) instead of a CDN: no
# third-party script in the desk, no SRI gap, and no runtime network call.
#
# It is NOT committed to this repository. build.js stages it from node_modules on
# `bench build`, because TinyMCE 8.x is GPLv2+/commercial and keeping it out of
# the repo keeps this app MIT for anyone who clones it — the GPL combination only
# ever exists on a deployed machine, which is private use. Config sets
# license_key = "gpl" for the GPL terms that deployment runs under.
#
# tinymce.min.js stays unbundled so TinyMCE can lazy-load its own skins, themes,
# plugins and language packs relative to that path.
def _tinymce_script():
    """Version-scoped URL for the TinyMCE core.

    TinyMCE lazily loads its theme, model, skins, plugins and language packs
    relative to the URL the core was loaded from. Serving it from a stable path
    lets a browser pair a cached core with a freshly fetched theme after an
    upgrade, which throws inside the theme and renders no editor at all. The
    version in the path makes that mismatch impossible.

    build.js writes public/tinymce/CURRENT when it stages the assets.
    """
    import os

    staged = os.path.join(os.path.dirname(__file__), "public", "tinymce")

    version = ""
    try:
        with open(os.path.join(staged, "CURRENT")) as f:
            version = f.read().strip()
    except OSError:
        # CURRENT can be missing if the assets were staged by an older build.
        # Fall back to whatever version directory is actually on disk, so a
        # missing marker degrades into the right URL instead of a 404.
        try:
            versions = sorted(
                d
                for d in os.listdir(staged)
                if os.path.isfile(os.path.join(staged, d, "tinymce.min.js"))
            )
            version = versions[-1] if versions else ""
        except OSError:
            version = ""

    if version:
        return f"/assets/frappe_tinymce/tinymce/{version}/tinymce.min.js"
    # Nothing staged yet (fresh clone before `bench build`).
    return "/assets/frappe_tinymce/tinymce/tinymce.min.js"


app_include_js = [
    _tinymce_script(),
    "frappe_tinymce.bundle.js",
]

# include js, css files in header of web template
# web_include_css = "/assets/frappe_tinymce/css/frappe_tinymce.css"
# web_include_js = "/assets/frappe_tinymce/js/frappe_tinymce.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "frappe_tinymce/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
#	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "frappe_tinymce.utils.jinja_methods",
# 	"filters": "frappe_tinymce.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "frappe_tinymce.install.before_install"
# after_install = "frappe_tinymce.install.after_install"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "frappe_tinymce.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
#	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"frappe_tinymce.tasks.all"
# 	],
# 	"daily": [
# 		"frappe_tinymce.tasks.daily"
# 	],
# 	"hourly": [
# 		"frappe_tinymce.tasks.hourly"
# 	],
# 	"weekly": [
# 		"frappe_tinymce.tasks.weekly"
# 	],
# 	"monthly": [
# 		"frappe_tinymce.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "frappe_tinymce.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "frappe_tinymce.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "frappe_tinymce.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]


# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"frappe_tinymce.auth.validate"
# ]

