// This module exports a function that runs INSIDE the browser page context.
// It must be self-contained — no closure references to outer scope, no imports.
// We pass it to page.evaluate() which serializes it.

export interface SnapshotOptions {
  compact: boolean;
}

export interface SnapshotPayload {
  text: string;
  refCount: number;
}

export function snapshotScript(opts: SnapshotOptions): SnapshotPayload {
  const compact = opts.compact;

  // Strip prior refs.
  document.querySelectorAll("[data-agent-ref]").forEach((el) => {
    el.removeAttribute("data-agent-ref");
  });

  const INTERACTIVE_TAGS = new Set([
    "A",
    "BUTTON",
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "OPTION",
    "SUMMARY",
    "DETAILS",
    "LABEL",
  ]);
  const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "switch",
    "menuitem",
    "tab",
    "option",
    "combobox",
    "searchbox",
    "slider",
  ]);
  const STRUCTURAL_TAGS = new Set(["HEADER", "NAV", "MAIN", "ASIDE", "FOOTER", "SECTION", "ARTICLE", "FORM"]);
  const TEXTUAL_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI"]);

  function isVisible(el: Element): boolean {
    const he = el as HTMLElement;
    if (he.offsetParent !== null) return true;
    const rect = he.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
    // <option> elements have no offsetParent and zero rect; treat as visible if their <select> is visible.
    if (el.tagName === "OPTION") {
      const select = el.closest("select");
      if (select) {
        const sr = (select as HTMLElement).getBoundingClientRect();
        return sr.width > 0 && sr.height > 0;
      }
    }
    return false;
  }

  function getRole(el: Element): string {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName;
    switch (tag) {
      case "A":
        return (el as HTMLAnchorElement).href ? "link" : "generic";
      case "BUTTON":
        return "button";
      case "INPUT": {
        const type = ((el as HTMLInputElement).type || "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "submit" || type === "button" || type === "reset") return "button";
        if (type === "search") return "searchbox";
        return "textbox";
      }
      case "TEXTAREA":
        return "textbox";
      case "SELECT":
        return "combobox";
      case "OPTION":
        return "option";
      case "DETAILS":
        return "group";
      case "SUMMARY":
        return "button";
      case "LABEL":
        return "label";
      case "HEADER":
        return "banner";
      case "NAV":
        return "navigation";
      case "MAIN":
        return "main";
      case "ASIDE":
        return "complementary";
      case "FOOTER":
        return "contentinfo";
      case "FORM":
        return "form";
      case "SECTION":
        return el.getAttribute("aria-label") ? "region" : "section";
      case "ARTICLE":
        return "article";
      default:
        if (tag.startsWith("H") && tag.length === 2) return "heading";
        if (tag === "P") return "paragraph";
        if (tag === "LI") return "listitem";
        return "generic";
    }
  }

  function clean(s: string | null | undefined): string {
    if (!s) return "";
    return s.replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function getName(el: Element): string {
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const ids = labelledby.split(/\s+/).filter(Boolean);
      const parts: string[] = [];
      for (const id of ids) {
        const refEl = document.getElementById(id);
        if (refEl) parts.push(refEl.textContent || "");
      }
      const joined = clean(parts.join(" "));
      if (joined) return joined;
    }
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const inp = el as HTMLInputElement | HTMLTextAreaElement;
      const ph = inp.getAttribute("placeholder");
      if (ph) return clean(ph);
      const id = inp.id;
      if (id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lbl) return clean(lbl.textContent);
      }
      const parentLabel = inp.closest("label");
      if (parentLabel) return clean(parentLabel.textContent);
      const v = inp.value;
      if (v) return clean(v);
      const name = inp.getAttribute("name");
      if (name) return clean(name);
      return "";
    }
    if (tag === "IMG") {
      return clean((el as HTMLImageElement).alt) || clean((el as HTMLImageElement).title);
    }
    if (tag === "A" || tag === "BUTTON" || tag === "SUMMARY" || tag === "OPTION" || tag === "LABEL") {
      return clean(el.textContent);
    }
    if (tag.startsWith("H") && tag.length === 2) return clean(el.textContent);
    return "";
  }

  function getStateSuffix(el: Element): string {
    const parts: string[] = [];
    const tag = el.tagName;
    const inp = el as HTMLInputElement;
    if ((tag === "INPUT" || tag === "BUTTON" || tag === "TEXTAREA" || tag === "SELECT") && inp.disabled) {
      parts.push("disabled");
    }
    if (tag === "INPUT") {
      const type = (inp.type || "").toLowerCase();
      if ((type === "checkbox" || type === "radio") && inp.checked) parts.push("checked");
    }
    const ariaExpanded = el.getAttribute("aria-expanded");
    if (ariaExpanded != null) parts.push(`expanded=${ariaExpanded}`);
    const ariaSelected = el.getAttribute("aria-selected");
    if (ariaSelected === "true") parts.push("selected");
    const ariaPressed = el.getAttribute("aria-pressed");
    if (ariaPressed != null) parts.push(`pressed=${ariaPressed}`);
    if (tag === "DETAILS" && (el as HTMLDetailsElement).open) parts.push("open");
    if (parts.length === 0) return "";
    return ` [${parts.join(", ")}]`;
  }

  function isInteractive(el: Element): boolean {
    if (INTERACTIVE_TAGS.has(el.tagName)) {
      // Skip empty/hidden inputs.
      if (el.tagName === "INPUT") {
        const t = ((el as HTMLInputElement).type || "").toLowerCase();
        if (t === "hidden") return false;
      }
      return true;
    }
    const role = el.getAttribute("role");
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    const tabindex = el.getAttribute("tabindex");
    if (tabindex !== null && parseInt(tabindex, 10) >= 0) return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
  }

  function isTextual(el: Element): boolean {
    return TEXTUAL_TAGS.has(el.tagName);
  }

  function isStructural(el: Element): boolean {
    return STRUCTURAL_TAGS.has(el.tagName);
  }

  let refCounter = 1;
  const lines: string[] = [];

  // Title line first.
  const title = document.title || "";
  if (title) lines.push(`page "${clean(title)}" url=${location.href}`);
  else lines.push(`page url=${location.href}`);

  function walk(el: Element, depth: number): void {
    if (!(el instanceof Element)) return;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "META" || tag === "LINK") {
      return;
    }
    if (!isVisible(el)) {
      // Still walk children: invisible wrappers may have visible descendants.
      // But skip ourselves.
      for (const child of Array.from(el.children)) walk(child, depth);
      return;
    }

    const interactive = isInteractive(el);
    const structural = isStructural(el);
    const textual = isTextual(el);

    let emitted = false;
    if (interactive) {
      const ref = refCounter++;
      el.setAttribute("data-agent-ref", String(ref));
      const role = getRole(el);
      const name = getName(el);
      const state = getStateSuffix(el);
      const indent = "  ".repeat(depth);
      const namePart = name ? ` "${name}"` : "";
      lines.push(`${indent}- ${role}${namePart} [ref @e${ref}]${state}`);
      emitted = true;
    } else if (structural) {
      const role = getRole(el);
      const name = getName(el) || el.getAttribute("aria-label") || "";
      const indent = "  ".repeat(depth);
      const namePart = name ? ` "${clean(name)}"` : "";
      lines.push(`${indent}- ${role}${namePart}`);
      emitted = true;
    } else if (!compact && textual) {
      const role = getRole(el);
      const text = clean(el.textContent);
      if (text) {
        const indent = "  ".repeat(depth);
        lines.push(`${indent}- ${role} "${text}"`);
        emitted = true;
      }
    }

    const childDepth = emitted ? depth + 1 : depth;
    for (const child of Array.from(el.children)) walk(child, childDepth);
  }

  if (document.body) {
    for (const child of Array.from(document.body.children)) walk(child, 0);
  }

  return {
    text: lines.join("\n"),
    refCount: refCounter - 1,
  };
}
