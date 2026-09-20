# WebView2 ↔ Rust security boundary audit

Audit date: 2026-09-14. This was a static review of IPC commands, window
routing, atomic writes, format adapters, live preview, tauri.conf.json, and
capabilities. The application was not launched and files outside the project
were not read or changed.

## Executive summary

MarkNote intentionally opens user-selected files anywhere on disk, so a global
“only under the application directory” rule would be wrong. Images require a
separate boundary: an external Markdown document must not make read_image read
an arbitrary process-readable file and send its bytes to the WebView.

Main findings:

1. Medium: read_image accepts absolute paths and traversal and has no size
   limit unless the Rust command enforces one.
2. Medium data integrity: saving does not safely detect a file changed after
   opening; another program can lose its edits.
3. Medium compatibility: canonical_path strips the Windows extended-path
   prefix and can break long paths and UNC paths.
4. Medium: Ctrl-click blocks javascript only, but permits data, file, vbscript,
   and custom schemes through window.open.
5. Low/medium availability: KaTeX has no explicit maxSize, so hostile rules can
   make WebView layout extremely large.
6. Medium: unknown extensions may fall back to Plain Text, so binary files can
   be opened and later damaged despite the specification promising rejection.

## 1. Commands that accept paths

open_file canonicalizes traversal and accepts absolute paths. It follows
symlinks and junctions because the editor is deliberately allowed to open any
user file. Device names and NUL bytes rely on the OS for rejection. Stripping
the extended prefix can break paths beyond MAX_PATH and can turn
extended UNC paths into malformed paths.

save_file uses the supplied path without containment checks. Read-only metadata
is checked, but symlink and junction policy is not explicit and a race can
change the target between checking and replacement. save_as gets its target
from a native picker but has the same implicit symlink policy.

read_image is the sensitive command. Absolute Windows and UNC paths are used
directly; relative paths are joined to the document parent without a
canonicalize-and-containment check unless the current implementation adds one.
Symlinks and junctions can leave the document directory. The whole file is read,
then Base64 expands it to about four thirds of the input size before IPC and
WebView copies. A large image can therefore cause a freeze or OOM.

reveal_in_explorer passes one argument to Explorer without a shell, so no direct
command injection was found. open_in_new_window and take_pending_file inherit
route_file canonicalization.

### 1.1 Canonicalization and arbitrary files

Do not impose a general traversal, UNC, or symlink ban on open_file and saving:
that would break legitimate files in arbitrary folders and network shares.
Instead, apply a strict document-relative policy to read_image and preserve
extended Windows paths correctly.

### 1.2 Binary files

Startup and single-instance routing accept every argument for which
Path::is_file() is true. Unknown extensions can select PlainAdapter, whose
decoder accepts arbitrary bytes. A user can therefore open a binary file, see
garbage, and press Save. This is not remote execution but can corrupt data.

## 2. read_image as an untrusted-file boundary

The command returns data/http(s) URLs without reading them. For other sources it
must resolve the candidate relative to the document, canonicalize it, verify
that it remains under the allowed directory, reject device paths, and enforce
a byte limit before fs::read. Data URLs must not bypass the intended image
contract. The process does not gain new privileges, but exposing secret bytes
inside the process remains a confidentiality issue and would become more
dangerous if export or network upload is added.

## 3. Saving and source-file integrity

atomic_write creates a new sibling file, writes all bytes, synchronizes it, and
replaces the target. Ordinary write, space, read-only, or sharing errors do not
delete the old file in advance. Durable replacement after power loss is not
guaranteed without a write-through policy and target-platform verification.

Before release:

1. Compare disk identity, timestamp, size, or hash captured at open time before
   save and offer a conflict choice instead of overwriting silently.
2. Define explicit no-follow/realpath policy for symlinks and junctions.
3. Test durable replacement, full disks, sharing errors, and read-only files.

## 4. CSP, capabilities, and associations

The CSP uses self for default and scripts, data/HTTPS/assets for images, and
unsafe-inline styles for Svelte, CodeMirror StyleModule, and lazy KaTeX CSS.
HTTP images are not allowed by the CSP even if the specification mentions them;
this is a stricter functional mismatch. asset and plugin-fs capabilities appear
unused and should be narrowed only after runtime confirmation. unsafe-inline
should remain only with documented justification or be replaced by nonce/hash
if the build permits it.

The installer associates Markdown plus several code and text formats. FORMATS
promises that only the Markdown class takes over double-click behavior, so the
association list must be synchronized before release, including the mdx
extension.

## 5. Markdown as an untrusted data source

The reviewed live preview uses textContent or DOM properties for ordinary text,
callout titles, image labels, and fallback content. Links use decorations rather
than inserting an a element from document text. Callout icons come from a fixed
allowlist, and scripts or raw HTML remain text in CodeMirror. Image widgets set
src and labels as properties.

### Links

A Ctrl-click URL must use an allowlist, not only a javascript blacklist. Permit
http and https if required by the specification, route them through the
controlled external opener, and decide separately whether mailto is needed.
Block file, data, javascript, vbscript, and unknown schemes unconditionally.

### KaTeX

MathWidget calls KaTeX with throwOnError false and HTML plus MathML output.
KaTeX trust defaults to false, so commands requiring trust are not trusted.
Invalid formulas become visual errors. The remaining denial-of-service surface
is maxSize: a hostile rule such as rule{500000em}{500000em} can create an
extreme element and slow WebView layout. Set trust false explicitly and choose
a reasonable maxSize while retaining document-size and cache limits.

## 6. Launch arguments and associations

windows.rs processes command-line arguments and routes existing files. Options
are not interpreted as shell commands; a file named like an option is opened
only if it exists. Multiple files can produce multiple windows without a
specific count limit. Relative paths use the process current directory and
inherit the extended-path issue. Hardening should fix canonicalization and
bound the number of windows without forbidding arbitrary user paths.

## Release priorities

1. Add save conflict detection and explicit symlink/junction policy.
2. Canonicalize image candidates, enforce document containment, reject devices,
   and cap bytes before reading.
3. Replace URL blacklists with safe-scheme allowlists.
4. Preserve extended and UNC path forms and test long paths.
5. Reject binary files before open and keep only intended Markdown associations.
6. Set KaTeX trust false and maxSize.
7. Confirm or narrow unused CSP sources and plugin capabilities; document the
   deliberate unsafe-inline exception.
