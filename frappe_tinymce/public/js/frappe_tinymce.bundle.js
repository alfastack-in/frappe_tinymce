/**
 * Replace Frappe's Quill-based Text Editor with a self-hosted TinyMCE 6 editor.
 *
 * The control keeps Frappe's contract intact rather than only swapping the widget:
 *  - values round-trip through the `.ql-editor read-mode` wrapper Frappe's email,
 *    signature and print pipelines parse (see communication.py:set_signature_in_email_content)
 *  - parse() keeps Frappe's script/style sanitization
 *  - each control owns exactly one editor instance, so values never leak between docs
 */

const QL_WRAPPER_CLASS = "ql-editor read-mode";

function css_var(name, fallback) {
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return value || fallback;
}

function is_dark_theme() {
	const attr = document.documentElement.getAttribute("data-theme");
	if (attr) return attr === "dark";
	return (frappe.boot?.user?.desk_theme || "").toLowerCase() === "dark";
}

// Editors are registered globally by TinyMCE, so a control that goes away with its
// DOM leaves a live instance behind. Frappe controls have no destroy hook, so sweep
// detached editors whenever the route changes.
function sweep_detached_editors() {
	(tinymce.get() || []).forEach((editor) => {
		const container = editor.getContainer && editor.getContainer();
		if (!container || !document.body.contains(container)) {
			try {
				editor.remove();
			} catch (e) {
				// already gone
			}
		}
	});
}

frappe.ui.form.ControlTextEditor = class ControlTextEditor extends frappe.ui.form.ControlCode {
	make_wrapper() {
		super.make_wrapper();
	}

	make_input() {
		this.has_input = true;
		this.make_tinymce_editor();
	}

	make_tinymce_editor() {
		if (this._editor || this._editor_pending) return;
		this._editor_pending = true;

		this.tinymce_container = $("<div>").appendTo(this.input_area);

		tinymce
			.init({ target: this.tinymce_container[0], ...this.get_tinymce_options() })
			.then((editors) => {
				this._editor_pending = false;
				const editor = editors && editors[0];
				if (!editor) return;

				// Bind to this control only — never to tinymce.activeEditor, which is
				// whichever editor was touched last and is shared across the page.
				this._editor = editor;
				this.bind_editor_events(editor);
				this.bind_form_control_state(editor);

				const initial = this._pending_value !== undefined ? this._pending_value : this.value;
				this.write_to_editor(initial);
				this._pending_value = undefined;
				this.set_editor_mode();
			})
			.catch(() => {
				this._editor_pending = false;
			});
	}

	get_tinymce_options() {
		const dark = is_dark_theme();
		const direction = this.get_text_direction();

		const options = {
			base_url: "/assets/frappe_tinymce/tinymce",
			license_key: "gpl",
			menubar: false,
			branding: false,
			promotion: false,
			statusbar: false,
			skin: dark ? "oxide-dark" : "oxide",
			content_css: dark ? "dark" : "default",
			content_style: this.get_content_style(),
			directionality: direction,
			language: this.get_language(),
			toolbar_mode: "sliding",
			toolbar_sticky: true,
			convert_urls: false,
			relative_urls: false,
			remove_script_host: false,
			entity_encoding: "raw",
			default_link_target: "_blank",
			link_default_protocol: "https",
			browser_spellcheck: true,
			contextmenu: "link table",
			paste_data_images: true,
			automatic_uploads: true,
			images_file_types: "jpeg,jpg,png,gif,webp,svg",
			images_upload_handler: this.get_image_upload_handler(),
			extended_valid_elements: [
				"span[class|data-id|data-is-group|data-value|style]",
				"a[href|target|class|rel|title]",
				// Inline form controls used for questionnaires / checklists. `checked`
				// must be listed or the serialiser drops the state we mirror onto it.
				"input[type|checked|disabled|name|value|placeholder]",
				"label[for|class]",
			].join(","),
			plugins: [
				"autolink",
				"autoresize",
				"charmap",
				"code",
				"directionality",
				"emoticons",
				"fullscreen",
				"image",
				"link",
				"lists",
				"media",
				"preview",
				"searchreplace",
				"table",
				"visualblocks",
				"wordcount",
			].join(" "),
			// Only free-tier buttons. The upstream config listed premium items
			// (checklist, casechange, permanentpen, formatpainter, pageembed,
			// template, a11ycheck, addcomment, footnotes, mergetags) that silently
			// never render.
			// Ordered by how often a button is actually needed, not by convention.
			// toolbar_mode "sliding" hides the tail behind an overflow button, and
			// in a half-width column (a child-table detail form is ~370px) only the
			// first group or two survive — so formatting leads and undo/redo follow.
			toolbar: [
				"bold italic underline",
				"bullist numlist",
				"link",
				"undo redo",
				"blocks fontsize",
				"strikethrough forecolor backcolor removeformat",
				"alignleft aligncenter alignright alignjustify",
				"outdent indent",
				"ltr rtl",
				"image media table",
				"charmap emoticons",
				"searchreplace visualblocks code fullscreen",
			].join(" | "),
			font_size_formats: "10px 11px 12px 13px 14px 16px 18px 24px 36px",
			autoresize_bottom_margin: 16,
			min_height: this.df.min_height || 180,
			setup: (editor) => this.setup_editor(editor),
		};

		options.max_height = this.get_max_height();
		if (this.df.placeholder) {
			options.placeholder = __(this.df.placeholder);
		}
		// Space is tight inside a grid row — collapse to a single compact toolbar row.
		if (this.grid_row) {
			options.toolbar = "bold italic underline | bullist numlist | link | removeformat";
			options.toolbar_sticky = false;
		}
		return options;
	}

	setup_editor(editor) {
		this.setup_mentions(editor);

		// Ctrl/Cmd+S inside the editor iframe never reaches Frappe's document handler.
		editor.on("keydown", (e) => {
			if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "s") {
				e.preventDefault();
				e.stopPropagation();
				this.push_to_model(true);
				if (this.frm && this.frm.save_or_update) {
					this.frm.save_or_update();
				}
			}
		});
	}

	setup_mentions(editor) {
		if (!(this.enable_mentions || this.df.enable_mentions)) return;

		const method = this.mention_search_method || "frappe.desk.search.get_names_for_mentions";
		editor.ui.registry.addAutocompleter("frappe_mentions", {
			trigger: "@",
			minChars: 0,
			columns: 1,
			highlightOn: ["mention_name"],
			fetch: (pattern) =>
				frappe
					.xcall(method, { search_term: pattern })
					.then((values) =>
						(values || []).slice(0, 10).map((item) => ({
							type: "autocompleteitem",
							value: JSON.stringify(item),
							text: item.value,
							meta: { mention_name: item.value },
						}))
					)
					.catch(() => []),
			onAction: (autocompleteApi, range, value) => {
				let item;
				try {
					item = JSON.parse(value);
				} catch (e) {
					autocompleteApi.hide();
					return;
				}
				const escape = frappe.utils.escape_html;
				// Markup must match frappe.desk.notifications.extract_mentions, which
				// reads class="mention" + data-id (and data-is-group for User Groups).
				const group_attr = item.is_group ? ' data-is-group="true"' : "";
				const html =
					`<span class="mention" data-id="${escape(item.id)}"${group_attr}>` +
					`<a href="${escape(item.link || "#")}">@${escape(item.value)}</a>` +
					`</span>&nbsp;`;
				editor.selection.setRng(range);
				editor.insertContent(html);
				autocompleteApi.hide();
			},
		});
	}

	get_image_upload_handler() {
		// Without a handler TinyMCE inlines pasted images as base64 data URIs, which
		// bloats the column and creates no File record.
		return (blob_info) =>
			new Promise((resolve, reject) => {
				const form_data = new FormData();
				form_data.append("file", blob_info.blob(), blob_info.filename());
				form_data.append("is_private", 0);
				form_data.append("folder", "Home/Attachments");

				const doc = this.frm && this.frm.doc;
				if (doc && doc.doctype && doc.name && !doc.__islocal) {
					form_data.append("doctype", doc.doctype);
					form_data.append("docname", doc.name);
				}

				const xhr = new XMLHttpRequest();
				xhr.open("POST", "/api/method/upload_file");
				xhr.setRequestHeader("Accept", "application/json");
				if (frappe.csrf_token) {
					xhr.setRequestHeader("X-Frappe-CSRF-Token", frappe.csrf_token);
				}
				xhr.onload = () => {
					if (xhr.status < 200 || xhr.status >= 300) {
						reject({ message: __("Image upload failed"), remove: true });
						return;
					}
					try {
						const file_url = JSON.parse(xhr.responseText).message.file_url;
						resolve(file_url);
					} catch (e) {
						reject({ message: __("Could not read upload response"), remove: true });
					}
				};
				xhr.onerror = () => reject({ message: __("Image upload failed"), remove: true });
				xhr.send(form_data);
			});
	}

	// Clicking a checkbox or radio sets the DOM *property*; TinyMCE serialises
	// *attributes*. Without mirroring, getContent() is byte-identical before and
	// after a click, so the state is never stored and the form is never dirty.
	bind_form_control_state(editor) {
		const sync = (node) => {
			if (!node || node.nodeName !== "INPUT") return false;
			const type = (node.type || "").toLowerCase();
			if (type !== "checkbox" && type !== "radio") return false;

			// A read-only field must not be togglable; snap back to the stored state.
			if (this._editor && this._editor.mode.get() === "readonly") {
				node.checked = node.hasAttribute("checked");
				return false;
			}

			if (node.checked) {
				node.setAttribute("checked", "checked");
			} else {
				node.removeAttribute("checked");
			}
			return true;
		};

		const handler = (event) => {
			if (!sync(event.target)) return;
			// Attribute writes bypass the undo stack, so record one undo level.
			editor.undoManager.add();
			this.push_to_model();
		};

		const doc = editor.getDoc();
		// Capture phase, and both events: `click` also covers Space on a focused box.
		doc.addEventListener("click", handler, true);
		doc.addEventListener("change", handler, true);
	}

	bind_editor_events(editor) {
		const push = frappe.utils.debounce(() => this.push_to_model(), 300);
		editor.on("input Change Undo Redo", () => {
			if (!this._writing) push();
		});
		editor.on("blur", () => {
			if (!this._writing) this.push_to_model();
		});
	}

	push_to_model(immediate) {
		if (this._writing || !this._editor) return;
		const value = this.get_input_value();
		if (value === this.value) return;
		this.parse_validate_and_set_in_model(value);
		if (immediate && this.frm && this.frm.doc) {
			this.frm.doc[this.df.fieldname] = this.parse(value);
		}
	}

	// --- value plumbing -----------------------------------------------------

	strip_wrapper(html) {
		if (!html) return "";
		if (html.indexOf("ql-editor") === -1) return html;
		const holder = document.createElement("div");
		holder.innerHTML = html;
		const inner = holder.querySelector(".ql-editor");
		return inner ? inner.innerHTML : html;
	}

	write_to_editor(value) {
		if (!this._editor) return;
		// setContent(undefined) throws inside TinyMCE, which is why an empty field
		// used to log an uncaught TypeError on every form load.
		const html = this.strip_wrapper(value == null ? "" : String(value));
		this._writing = true;
		try {
			this._editor.setContent(html);
		} finally {
			this._writing = false;
		}
	}

	set_formatted_input(value) {
		// No this.frm access — dialogs and grid rows have no frm, and no
		// doc-level "already set" latch, which used to freeze the first value
		// written to the form and show stale content after navigating away.
		if (!this._editor) {
			this._pending_value = value;
			return;
		}
		if (value === this.get_input_value()) return;
		this.write_to_editor(value);
	}

	get_input_value() {
		if (!this._editor) return "";
		const content = this._editor.getContent() || "";
		if (!content.trim()) return "";
		if (content.indexOf("ql-editor") !== -1) return content;
		return `<div class="${QL_WRAPPER_CLASS}">${content}</div>`;
	}

	parse(value) {
		if (value == null) value = "";
		// ControlCode.parse() is a pass-through; Frappe's Text Editor strips
		// script/style here and losing it reintroduced a stored-XSS path.
		return this.strip_unsafe_attributes(frappe.dom.remove_script_and_style(value));
	}

	// remove_script_and_style() only removes tags, so inline handlers and
	// javascript: URLs survive it. The server strips these on save via
	// sanitize_html(); do the same here so what you see is what gets stored.
	strip_unsafe_attributes(html) {
		if (!html || html.indexOf("<") === -1) return html;
		if (!/\son[a-z]+\s*=|javascript:/i.test(html)) return html;

		const doc = new DOMParser().parseFromString(html, "text/html");
		doc.body.querySelectorAll("*").forEach((node) => {
			Array.from(node.attributes).forEach((attr) => {
				const name = attr.name.toLowerCase();
				const value = (attr.value || "").replace(/\s+/g, "").toLowerCase();
				if (name.startsWith("on")) {
					node.removeAttribute(attr.name);
				} else if (
					["href", "src", "xlink:href", "action", "formaction"].includes(name) &&
					value.startsWith("javascript:")
				) {
					node.removeAttribute(attr.name);
				}
			});
		});
		return doc.body.innerHTML;
	}

	set_focus() {
		if (this._editor) {
			this._editor.focus();
			return true;
		}
	}

	// --- state / presentation ----------------------------------------------

	refresh() {
		super.refresh();
		this.set_editor_mode();
	}

	set_editor_mode() {
		if (!this._editor) return;
		let read_only = !!(this.disabled || this.df.read_only);
		try {
			if (typeof this.get_status === "function") {
				read_only = read_only || this.get_status() === "Read";
			}
		} catch (e) {
			// get_status can throw for controls outside a form
		}
		try {
			this._editor.mode.set(read_only ? "readonly" : "design");
		} catch (e) {
			// editor torn down mid-refresh
		}
	}

	get_max_height() {
		// autoresize grows the editor to fit its content, so without a cap a long
		// letter turns the whole form into an endless scroll (measured: 150
		// paragraphs => 4393px editor inside a 5637px form). Past the cap the
		// editor scrolls internally; `fullscreen` is on the toolbar for long-form
		// editing.
		if (this.df.max_height) return parseInt(this.df.max_height, 10);
		if (this.grid_row) return 120;
		return frappe_tinymce.default_max_height;
	}

	get_text_direction() {
		if (this.df.text_direction) return this.df.text_direction;
		const fieldname = (this.df.fieldname || "").toLowerCase();
		if (/(^|_)(ar|arabic)$/.test(fieldname)) return "rtl";
		if (typeof frappe.utils.is_rtl === "function" && frappe.utils.is_rtl()) return "rtl";
		return document.documentElement.getAttribute("dir") === "rtl" ? "rtl" : "ltr";
	}

	get_language() {
		const lang = ((frappe.boot && frappe.boot.lang) || "en").trim();
		if (!lang || lang === "en") return "en";

		const packs = frappe_tinymce.available_languages;
		// Frappe uses codes like "ar", "pt-BR"; TinyMCE ships "ar", "pt_BR".
		const candidates = [lang, lang.replace(/-/g, "_"), lang.split(/[-_]/)[0]];
		for (const candidate of candidates) {
			if (packs.includes(candidate)) return candidate;
			const match = packs.find((p) => p.toLowerCase() === candidate.toLowerCase());
			if (match) return match;
		}
		// Claiming a pack that was not staged makes TinyMCE 404 and log an error.
		return "en";
	}

	get_content_style() {
		const dark = is_dark_theme();
		const text = css_var("--text-color", dark ? "#c7c7c7" : "#1f272e");
		const muted = css_var("--text-muted", dark ? "#8d96a0" : "#8d99a6");
		const bg = css_var("--card-bg", dark ? "#1c2126" : "#ffffff");
		const border = css_var("--border-color", dark ? "#333a40" : "#e2e6e9");
		const link = css_var("--text-on-light-blue", dark ? "#8ab4f8" : "#1958a8");
		const font = css_var(
			"--font-stack",
			'InterVariable, Inter, -apple-system, "system-ui", "Segoe UI", Roboto, sans-serif'
		);
		return `
			body { font-family: ${font}; font-size: 13px; line-height: 1.6;
			       color: ${text}; background-color: ${bg}; margin: 8px 12px; }
			a { color: ${link}; }
			p { margin: 0 0 8px; }
			blockquote { border-left: 3px solid ${border}; margin: 0 0 8px; padding-left: 12px; color: ${muted}; }
			table { border-collapse: collapse; }
			table td, table th { border: 1px solid ${border}; padding: 4px 8px; }
			img { max-width: 100%; height: auto; }
			code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
			.mention { background-color: ${border}; border-radius: 3px; padding: 0 3px; }
			.mention a { text-decoration: none; }
		`;
	}

	// Skin and content CSS are chosen at init and cannot be hot-swapped, so a
	// theme change rebuilds the editor in place.
	rebuild_for_theme() {
		if (!this._editor) return;
		const value = this.get_input_value();
		try {
			this._editor.remove();
		} catch (e) {
			// already gone
		}
		this._editor = null;
		if (this.tinymce_container) this.tinymce_container.remove();
		this._pending_value = value;
		this.make_tinymce_editor();
	}
};

// Comments intentionally stay on Quill: frappe.ui.form.ControlComment subclasses
// ControlTextEditor when controls.bundle.js loads (before this file runs) and
// depends on Quill directly for submit/clear/enable/disable and its own toolbar.
window.frappe_tinymce = {
	// Default cap for Text Editor fields, in px. Override globally from a client
	// script (frappe_tinymce.default_max_height = 700) or per field by setting
	// max_height on the docfield / Property Setter.
	default_max_height: 480,
	// Packs staged into public/tinymce/langs by build.js; keep this list in
	// sync with tinymce-i18n/langs8 when bumping the TinyMCE major version.
	available_languages: ["ar","ar-SA","az","be","bg-BG","bn-BD","bs","ca","cs","cy","da","de","el","eo","es","es-MX","et","eu","fa","fi","fr-FR","gl","he-IL","hr","hu-HU","hy","id","is-IS","it","ja","ka-GE","kab","kk","ko-KR","lt","lv","nb-NO","ne","nl","nl-BE","oc","pl","pt-BR","pt-PT","ro","ru","sk","sl-SI","sr","sv-SE","ta","tg","th-TH","tr","ug","uk","vi","zh-CN","zh-HK","zh-MO","zh-TW"],
	sweep_detached_editors,
};

$(document).ready(() => {
	if (frappe.router && frappe.router.on) {
		frappe.router.on("change", () => sweep_detached_editors());
	}

	let last_theme = is_dark_theme();
	new MutationObserver(() => {
		const now = is_dark_theme();
		if (now === last_theme) return;
		last_theme = now;
		const controls = [];
		if (window.cur_frm && cur_frm.fields_dict) {
			Object.values(cur_frm.fields_dict).forEach((field) => {
				if (field && field._editor && field.rebuild_for_theme) controls.push(field);
			});
		}
		controls.forEach((control) => control.rebuild_for_theme());
	}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
});
