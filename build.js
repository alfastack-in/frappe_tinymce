/**
 * Stage TinyMCE into frappe_tinymce/public/tinymce so Frappe can serve it from
 * /assets/frappe_tinymce/tinymce/.
 *
 * TinyMCE is a build-time dependency rather than a vendored copy on purpose:
 * 8.x is GPLv2+/commercial, and keeping it out of the repository keeps this app
 * MIT for anyone who clones it. The GPL combination only ever exists on a
 * deployed machine, which is private use and carries no distribution duty.
 *
 * Frappe runs this via `yarn build` on every `bench build` (esbuild.js ->
 * run_build_command_for_apps), so it exits early when the staged copy is
 * already current.
 */

const fs = require("fs");
const path = require("path");

const APP_ROOT = __dirname;
const SRC = path.join(APP_ROOT, "node_modules", "tinymce");
const I18N = path.join(APP_ROOT, "node_modules", "tinymce-i18n", "langs8");
const STAGE_ROOT = path.join(APP_ROOT, "frappe_tinymce", "public", "tinymce");
const CURRENT = path.join(STAGE_ROOT, "CURRENT");

const COPY_DIRS = ["themes", "models", "icons", "plugins", "skins"];

function tinymce_version() {
	return require(path.join(SRC, "package.json")).version;
}

function is_current(version) {
	try {
		return (
			fs.readFileSync(CURRENT, "utf8").trim() === version &&
			fs.existsSync(path.join(STAGE_ROOT, version, "tinymce.min.js"))
		);
	} catch (e) {
		return false;
	}
}

// Assets are staged under a version directory. TinyMCE lazily loads its theme,
// model, skins and plugins relative to the URL it was loaded from, so a stable
// path lets a browser mix a cached core with a freshly fetched theme after an
// upgrade — which throws deep inside the theme and renders nothing at all.
function prune_old_versions(keep) {
	if (!fs.existsSync(STAGE_ROOT)) return;
	for (const entry of fs.readdirSync(STAGE_ROOT, { withFileTypes: true })) {
		if (entry.isDirectory() && entry.name !== keep) {
			fs.rmSync(path.join(STAGE_ROOT, entry.name), { recursive: true, force: true });
		}
	}
}

// Ship only minified assets; the unminified twins roughly double the payload.
function prune(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const target = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			prune(target);
		} else if (
			entry.name.endsWith(".map") ||
			(entry.name.endsWith(".js") && !entry.name.endsWith(".min.js")) ||
			(entry.name.endsWith(".css") && !entry.name.endsWith(".min.css"))
		) {
			fs.rmSync(target);
		}
	}
}

function main() {
	if (!fs.existsSync(SRC)) {
		console.error("tinymce not found in node_modules — run `yarn install` first.");
		process.exit(1);
	}

	const version = tinymce_version();
	if (is_current(version)) {
		console.log(`tinymce ${version} already staged, skipping.`);
		return;
	}

	const DEST = path.join(STAGE_ROOT, version);
	fs.rmSync(DEST, { recursive: true, force: true });
	fs.mkdirSync(DEST, { recursive: true });

	fs.copyFileSync(path.join(SRC, "tinymce.min.js"), path.join(DEST, "tinymce.min.js"));
	// Ship TinyMCE's own licence alongside it, as GPLv2+ requires.
	for (const notice of ["license.md", "notices.txt"]) {
		const from = path.join(SRC, notice);
		if (fs.existsSync(from)) fs.copyFileSync(from, path.join(DEST, notice));
	}

	for (const dir of COPY_DIRS) {
		const from = path.join(SRC, dir);
		if (fs.existsSync(from)) fs.cpSync(from, path.join(DEST, dir), { recursive: true });
	}

	if (fs.existsSync(I18N)) {
		const langs = path.join(DEST, "langs");
		fs.mkdirSync(langs, { recursive: true });
		for (const file of fs.readdirSync(I18N)) {
			if (file.endsWith(".js")) fs.copyFileSync(path.join(I18N, file), path.join(langs, file));
		}
	}

	// Prune only the asset dirs: language packs ship unminified (ar.js, de.js)
	// and would otherwise be deleted as "non-min" files.
	for (const dir of COPY_DIRS) {
		const target = path.join(DEST, dir);
		if (fs.existsSync(target)) prune(target);
	}
	prune_old_versions(version);
	fs.writeFileSync(CURRENT, version + "\n");

	const langs = fs.existsSync(path.join(DEST, "langs"))
		? fs.readdirSync(path.join(DEST, "langs")).length
		: 0;
	console.log(`Staged tinymce ${version} (${langs} language packs) into public/tinymce/${version}.`);
}

main();
