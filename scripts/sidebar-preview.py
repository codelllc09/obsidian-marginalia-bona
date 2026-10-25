#!/usr/bin/env python3
"""Generate a full-sidebar preview page from styles.css for visual checks.

Usage: python3 scripts/sidebar-preview.py [output.html]
Then screenshot with headless Chrome and inspect:
  google-chrome --headless=new --screenshot=/tmp/p.png \
    --window-size=560,1240 --force-device-scale-factor=2 \
    --hide-scrollbars file:///tmp/sidebar-preview.html

Per AGENTS.md: UI changes must be verified this way (whole page, light and
dark) before deploying.
"""
import sys

css = open("styles.css").read()
img = ("<img src=\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' "
       "width='480' height='150'%3E%3Crect width='480' height='150' fill='%23dbe9ff'/%3E%3Ctext "
       "x='50%25' y='50%25' text-anchor='middle' fill='%233457a5' font-size='22'%3E"
       "480 x 150 screenshot%3C/text%3E%3C/svg%3E\">")


CHEVRON = ("<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" "
           "stroke-width=\"2\"><path d=\"m6 9 6 6 6-6\"/></svg>")
CHECK = ("<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" "
         "stroke-width=\"2\"><path d=\"M20 6 9 17l-5-5\"/></svg>")
ICON_COLLAPSE = ("<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\">"
                 "<path d=\"M4 14h6v6M20 10h-6V4M14 10l6-6M4 20l6-6\"/></svg>")
ICON_UP = ("<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\">"
           "<path d=\"M12 19V5M5 12l7-7 7 7\"/></svg>")
ICON_DOWN = ("<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\">"
             "<path d=\"M12 5v14M19 12l-7 7-7-7\"/></svg>")


def dropdown(name, current, options, open_menu=False, end_align=False):
    items = []
    for option in options:
        selected = " is-selected" if option == current else ""
        items.append(
            '<button class="marginalia-dropdown-item' + selected + '" role="menuitemradio">'
            '<span class="marginalia-dropdown-check">' + CHECK + '</span>'
            '<span class="marginalia-dropdown-item-label">' + option + '</span></button>')
    return ('\n    <div class="marginalia-dropdown-wrap">'
            '<button class="marginalia-dropdown" aria-haspopup="menu">'
            '<span class="marginalia-dropdown-label">' + name + ': ' + current + '</span>'
            '<span class="marginalia-dropdown-icon">' + CHEVRON + '</span></button>'
            '<div class="marginalia-dropdown-menu' + (' is-open' if open_menu else '') + (' is-end' if end_align else '') + '" role="menu">'
            + "".join(items) + '</div></div>')


def toolbar(open_which=""):
    return ("\n  <input class=\"marginalia-search\" type=\"search\" placeholder=\"Search annotations...\">\n"
            "  <div class=\"marginalia-toolbar\">\n"
            "    <button class=\"clickable-icon marginalia-collapse-toggle\">" + ICON_COLLAPSE + "</button>\n"
            "    <button class=\"clickable-icon marginalia-scroll-button\">" + ICON_UP + "</button>\n"
            "    <button class=\"clickable-icon marginalia-scroll-button\">" + ICON_DOWN + "</button>\n"
            "  </div>\n"
            "  <div class=\"marginalia-filter-row\">"
            + dropdown("Status", "Open", ["Open", "Unread", "Drifted", "Resolved", "Orphaned", "All"], open_which == "status")
            + dropdown("Scope", "Current file", ["Current file", "Whole vault"])
            + dropdown("Sort", "Source order", ["Source order", "Created newest", "Created oldest", "Updated newest"], open_which == "sort", end_align=open_which == "sort")
            + "</div>\n")


def card(drift, collapsed, resolved, orphan, replies, unread=False):
    status = "orphaned" if orphan else ("resolved" if resolved else "open")
    status_span = '<span class="marginalia-card-status">orphaned</span>' if orphan else ''
    drift_html = ''
    if drift:
        drift_html = ('<div class="marginalia-card-drift"><div class="marginalia-card-drift-head">'
                      '<span class="marginalia-card-drift-chip">text changed</span>'
                      '<button class="clickable-icon marginalia-card-drift-accept"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg></button></div>'
                      '<span class="marginalia-card-drift-original">original text that was selected when the annotation was made</span></div>')
    quote = ('<blockquote class="marginalia-card-quote marginalia-mark-highlight">'
             's然后，修改一下吧，哈哈哈</blockquote>')
    if orphan:
        body_imgs = '<div class="marginalia-card-body markdown-rendered"><p>测试新功能；格式有了。</p></div>'
    else:
        cls = ('marginalia-card-body markdown-rendered'
               + (' marginalia-imgs-collapsed' if collapsed else ''))
        body_imgs = ('<div class="' + cls + '"><p>测试新功能；格式有了，回复也可以。</p>'
                     '<span class="marginalia-img-frame">' + img + '</span>'
                     '<p>再看一张：</p><span class="marginalia-img-frame">' + img + '</span></div>')
    copy_icon = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
                 '<rect x="8" y="8" width="12" height="12" rx="2"/>'
                 '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>')
    remove_icon = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
                   '<path d="M18 6 6 18M6 6l12 12"/></svg>')
    reply_html = ''
    if replies:
        reply_html += '<div class="marginalia-replies">'
        for r in range(replies):
            reply_html += ('<div class="marginalia-reply">'
                           '<div class="marginalia-reply-head">'
                           '<span class="marginalia-reply-author">user</span>'
                           '<span class="marginalia-reply-time">09:14</span>'
                           '<div class="marginalia-reply-actions">'
                           '<button class="clickable-icon">' + copy_icon + '</button>'
                           '<button class="clickable-icon">' + remove_icon + '</button>'
                           '</div></div>'
                           '<div class="marginalia-reply-body markdown-rendered">'
                           '<p>回复 ' + str(r + 1) + '：回复的样式参考一下 word。</p></div></div>')
        reply_html += '</div>'
    footer = ('<div class="marginalia-card-footer">'
              '<button class="marginalia-footer-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/><path d="m21 17-3-3 3-3"/></svg><span>Reply</span></button>'
              '<div class="marginalia-card-footer-spacer"></div>'
              '<button class="marginalia-footer-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg><span>Edit</span></button>'
              + ('<button class="marginalia-footer-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg><span>Read</span></button>' if unread else '')
              + '<button class="marginalia-footer-action"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg><span>Jump</span></button>'
              + '</div>')
    is_active = ' is-active' if (resolved and drift) else ''
    card_html = ('\n    <div class="marginalia-card marginalia-status-' + status + is_active + '">\n'
                 '      <div class="marginalia-card-header">\n'
                 '        <button class="clickable-icon marginalia-card-collapse"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>\n'
                 '        <span class="marginalia-card-source">2026-10-24.md</span>\n'
                 + ('        <span class="marginalia-card-unread" title="Unread annotation"></span>\n' if unread else '')
                 + '        <span class="marginalia-card-replies-badge">' + str(replies) + '</span>\n'
                 '        ' + status_span + '\n'
                 '        <div class="marginalia-card-actions">\n'
                 '          <button class="clickable-icon marginalia-card-resolve"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></button>\n'
                 '          <button class="clickable-icon marginalia-card-copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>\n'
                 '          <button class="clickable-icon" title="More actions"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg></button>\n'
                 '        </div>\n      </div>\n')
    if drift:
        card_html += '      ' + drift_html + '\n'
    if not orphan:
        card_html += '      ' + quote + '\n'
    card_html += '      ' + body_imgs + '\n'
    if replies:
        card_html += reply_html + '\n'
    card_html += footer + '\n    </div>\n'
    opens = card_html.count('<div')
    closes = card_html.count('</div>')
    assert opens == closes, f"div imbalance: {opens} vs {closes}"
    return card_html


def page(dark, open_which="", width=600, flash=False):
    theme_vars = ("--text-normal:#ddd; --text-muted:#999; --text-faint:#666; --interactive-accent:#8b5cf6; "
                  "--background-primary:#262626; --background-secondary:#202020; "
                  "--background-secondary-alt:#2a2a2a; --background-modifier-border:#444;") if dark else \
                 ("--text-normal:#222; --text-muted:#666; --text-faint:#999; --interactive-accent:#7c4dff; "
                  "--background-primary:#fff; --background-secondary:#f6f6f6; "
                  "--background-secondary-alt:#ececec; --background-modifier-border:#ddd;")
    base = ('body { font: 16px/1.6 -apple-system, sans-serif; margin: 0; padding: 10px 14px; background:'
            + ('#1a1a1a' if dark else '#fff') + '; }\n'
            'h3 { color: var(--text-muted); font-size: 13px; margin: 10px 0 6px; }\n'
            '.marginalia-sidebar { max-width: 600px; }\n'
            '.clickable-icon { align-items: center; background: transparent; border: none; border-radius: 4px; '
            'box-shadow: none; color: var(--text-muted); display: inline-flex; height: 1.6em; '
            'justify-content: center; padding: 0; width: 1.6em; }\n'
            '.clickable-icon svg { height: 1em; width: 1em; }\n'
            ':root { --size-4-1:4px; --size-4-2:8px; --size-4-3:12px; --size-4-4:16px; --font-ui-small:13px; '
            '--font-ui-smaller:12px; --font-ui-smallest:11px; --radius-m:6px; --radius-s:4px; '
            '--shadow-s:0 2px 8px rgba(0,0,0,.15); --shadow-l:0 8px 24px rgba(0,0,0,.25); --layer-modal:30; '
            '--font-bold:700; --text-on-accent:#fff; --color-yellow:#ffd54f; '
            '--background-modifier-hover:rgba(127,127,127,.12); }\n'
            ':root { ' + theme_vars + ' }')
    return ('<!doctype html><html><head><meta charset="utf-8"><style>\n' + base
            + '\n</style>\n<style>\n' + css + '\n</style></head><body>\n'
            + '<h3>' + ('Dark' if dark else 'Light') + '</h3>\n'
            + '<div class="marginalia-sidebar" style="max-width:' + str(width) + 'px">' + toolbar(open_which)
            + '\n<div class="marginalia-body"><div class="marginalia-list">\n'
            + (card(True, False, False, False, 2).replace(
                'class="marginalia-card', 'class="marginalia-card is-active is-flashing', 1)
               if flash else card(True, False, False, False, 2))
            + card(False, True, False, False, 0, unread=True)
            + card(False, False, True, False, 1)
            + card(False, False, False, True, 0)
            + '\n</div></div></div>\n</body></html>')


out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sidebar-preview"
open(out + "-light.html", "w").write(page(False))
open(out + "-dark.html", "w").write(page(True))
open(out + "-light-menu.html", "w").write(page(False, "status"))
open(out + "-dark-menu.html", "w").write(page(True, "status"))
open(out + "-flash.html", "w").write(page(False, "", 600, flash=True))
open(out + "-narrow-status.html", "w").write(page(False, "status", 380))
open(out + "-narrow-sort.html", "w").write(page(False, "sort", 380))
print("written 6 variants under " + out)
