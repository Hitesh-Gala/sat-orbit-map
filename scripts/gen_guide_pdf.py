# -*- coding: utf-8 -*-
"""Build docs/NAZAR-Field-Guide.pdf - the standalone guide linked from the
foot of the Site Analytics page.

Two readers share one document.  The first wants to know how NAZAR works and
why it is built the way it is; the second has never opened a GitHub account and
wants to build something like it.  Part 4 is written for the second reader and
assumes nothing, so the earlier parts can stay explanatory rather than
tutorial.

Typography note: this uses reportlab's BUILT-IN fonts (Helvetica, Courier)
rather than embedding a system font.  The PDF is published on a public site, so
no font licensing question should arise, and the built-ins render identically
on every reader.  The price is the WinAnsi character set: no arrows, no
mathematical symbols, no emoji.  Write '->' and '<=' instead, and keep to
Latin-1 plus the usual typographic punctuation.

Run from the repository root:
    python scripts/gen_guide_pdf.py
"""

import os
import sys
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, NextPageTemplate,
                                PageBreak, PageTemplate, Paragraph, Preformatted,
                                Spacer, Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

OUT = os.path.join('docs', 'NAZAR-Field-Guide.pdf')
BUILT = date.today().strftime('%d %B %Y')

# --------------------------------------------------------------------------
# Palette - one hue per part, which is how the parts are told apart.
# --------------------------------------------------------------------------
INK      = colors.HexColor('#15202b')
BODY     = colors.HexColor('#24323f')
MUTED    = colors.HexColor('#5d7083')
RULE     = colors.HexColor('#d4dde5')
PAPER    = colors.HexColor('#ffffff')

PARTS = [
    ('#0f6f8c', 'The big picture'),        # 1 teal
    ('#a8650c', 'Where the data comes from'),  # 2 amber
    ('#6a4a9c', 'How the pieces are built'),   # 3 violet
    ('#246b45', 'Build one yourself'),         # 4 green
    ('#9e3b45', 'Questions and answers'),      # 5 red
    ('#44586b', 'Reference'),                  # 6 slate
]

_state = {'part': 0}


def tint(hexcolor, amount):
    """Mix a colour towards white; amount 0 = unchanged, 1 = white."""
    c = colors.HexColor(hexcolor)
    return colors.Color(c.red + (1 - c.red) * amount,
                        c.green + (1 - c.green) * amount,
                        c.blue + (1 - c.blue) * amount)


# --------------------------------------------------------------------------
# Styles
# --------------------------------------------------------------------------
ss = getSampleStyleSheet()

S = {}
S['body'] = ParagraphStyle('body', parent=ss['BodyText'], fontName='Helvetica',
                           fontSize=9.6, leading=14.2, textColor=BODY,
                           alignment=TA_JUSTIFY, spaceBefore=0, spaceAfter=7)
S['lead'] = ParagraphStyle('lead', parent=S['body'], fontSize=11, leading=16,
                           textColor=INK, spaceAfter=10)
S['bullet'] = ParagraphStyle('bullet', parent=S['body'], leftIndent=11,
                             bulletIndent=1, spaceAfter=4, alignment=TA_JUSTIFY)
S['code'] = ParagraphStyle('code', fontName='Courier', fontSize=7.9, leading=10.6,
                           textColor=colors.HexColor('#1d2b36'))
S['caption'] = ParagraphStyle('caption', parent=S['body'], fontSize=8.2,
                              textColor=MUTED, spaceBefore=2, spaceAfter=9,
                              alignment=TA_CENTER)
S['th'] = ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=8.3,
                         leading=11, textColor=colors.white)
S['td'] = ParagraphStyle('td', fontName='Helvetica', fontSize=8.3, leading=11.4,
                         textColor=BODY)
S['tdb'] = ParagraphStyle('tdb', parent=S['td'], fontName='Helvetica-Bold')
S['tdc'] = ParagraphStyle('tdc', parent=S['td'], fontName='Courier', fontSize=7.6)
S['q'] = ParagraphStyle('q', fontName='Helvetica-Bold', fontSize=10, leading=13.6,
                        textColor=INK, spaceBefore=3, spaceAfter=3)
S['callout'] = ParagraphStyle('callout', parent=S['body'], fontSize=9.2,
                              leading=13.4, spaceAfter=0)
S['calloutHead'] = ParagraphStyle('calloutHead', fontName='Helvetica-Bold',
                                  fontSize=8.2, leading=11, spaceAfter=3)
S['toc0'] = ParagraphStyle('toc0', fontName='Helvetica-Bold', fontSize=10.4,
                           leading=17, textColor=INK, spaceBefore=9)
S['toc1'] = ParagraphStyle('toc1', fontName='Helvetica', fontSize=9.2,
                           leading=13.6, textColor=BODY, leftIndent=13)


def heading_styles():
    """Per-part heading styles, rebuilt whenever the part changes."""
    hexc = PARTS[_state['part']][0]
    return (
        ParagraphStyle('h2_%s' % hexc, fontName='Helvetica-Bold', fontSize=14.5,
                       leading=18, textColor=colors.HexColor(hexc),
                       spaceBefore=16, spaceAfter=7),
        ParagraphStyle('h3_%s' % hexc, fontName='Helvetica-Bold', fontSize=10.6,
                       leading=14, textColor=INK, spaceBefore=11, spaceAfter=4),
    )


# --------------------------------------------------------------------------
# Flowable builders
# --------------------------------------------------------------------------
story = []


def P(text, style='body'):
    story.append(Paragraph(text, S[style]))


def BULLETS(items, dash=False):
    mark = '–' if dash else '•'
    for it in items:
        story.append(Paragraph(it, S['bullet'], bulletText=mark))
    story.append(Spacer(1, 4))


def GAP(h=6):
    story.append(Spacer(1, h))


class PartDivider(Paragraph):
    """Marks a part start so afterFlowable can file a level-0 TOC entry."""

    def __init__(self, number, title, style):
        self.toc_level = 0
        self.toc_text = '<font color="%s">Part %d — %s</font>' % (
            PARTS[number - 1][0], number, title)
        Paragraph.__init__(self, title, style)


class SectionHead(Paragraph):
    def __init__(self, number, title, style):
        self.toc_level, self.toc_text = 1, '%s  %s' % (number, title)
        Paragraph.__init__(self, '%s&nbsp;&nbsp;%s' % (number, title), style)


def PART(number, blurb):
    """A full-bleed coloured divider page opening a part."""
    _state['part'] = number - 1
    hexc, title = PARTS[number - 1]
    story.append(NextPageTemplate('part%d' % number))
    story.append(PageBreak())
    story.append(Spacer(1, 52 * mm))
    story.append(Paragraph('PART %d' % number,
                           ParagraphStyle('pn', fontName='Helvetica-Bold', fontSize=11,
                                          textColor=colors.white, spaceAfter=8)))
    story.append(PartDivider(number, title,
                             ParagraphStyle('pt', fontName='Helvetica-Bold', fontSize=27,
                                            leading=32, textColor=colors.white,
                                            spaceAfter=14)))
    story.append(Paragraph(blurb,
                           ParagraphStyle('pb', fontName='Helvetica', fontSize=11.4,
                                          leading=17, textColor=colors.HexColor('#e9f1f6'))))
    story.append(NextPageTemplate('main%d' % number))
    story.append(PageBreak())


def H2(number, title):
    h2, _ = heading_styles()
    hexc = PARTS[_state['part']][0]
    story.append(Spacer(1, 2))
    story.append(SectionHead(number, title, h2))
    story.append(HR(hexc))


def H3(title):
    _, h3 = heading_styles()
    story.append(Paragraph(title, h3))


def HR(hexc, w=1.1, space=7):
    t = Table([['']], colWidths=[165 * mm], rowHeights=[0.1])
    t.setStyle(TableStyle([
        ('LINEABOVE', (0, 0), (-1, -1), w, colors.HexColor(hexc)),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), space),
    ]))
    return t


def CODE(text, caption=None):
    # Everything else here is a Paragraph, which parses its text as markup, so
    # the content module escapes &amp; &lt; &gt; throughout.  Preformatted does
    # NOT parse markup - it would print those entities literally - so undo the
    # escaping here instead of asking the writer to remember the difference.
    for ent, ch in (('&lt;', '<'), ('&gt;', '>'), ('&amp;', '&')):
        text = text.replace(ent, ch)
    hexc = PARTS[_state['part']][0]
    body = Preformatted(text.strip('\n'), S['code'])
    t = Table([[body]], colWidths=[165 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f4f7f9')),
        ('LINEBEFORE', (0, 0), (0, -1), 2.4, colors.HexColor(hexc)),
        ('BOX', (0, 0), (-1, -1), 0.4, RULE),
        ('LEFTPADDING', (0, 0), (-1, -1), 9),
        ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    story.append(KeepTogether([t] if not caption else [t, Paragraph(caption, S['caption'])]))
    if not caption:
        story.append(Spacer(1, 9))


CALLOUTS = {
    'plain':  ('#0f6f8c', 'IN PLAIN WORDS'),
    'why':    ('#246b45', 'WHY IT IS DONE THIS WAY'),
    'gotcha': ('#a8650c', 'A TRAP TO AVOID'),
    'try':    ('#6a4a9c', 'TRY IT YOURSELF'),
}


def NOTE(kind, text, head=None):
    hexc, label = CALLOUTS[kind]
    inner = [
        Paragraph(head or label,
                  ParagraphStyle('ch', parent=S['calloutHead'],
                                 textColor=colors.HexColor(hexc))),
        Paragraph(text, S['callout']),
    ]
    t = Table([[inner]], colWidths=[165 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), tint(hexc, 0.93)),
        ('LINEBEFORE', (0, 0), (0, -1), 2.6, colors.HexColor(hexc)),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
    ]))
    story.append(t)
    story.append(Spacer(1, 10))


def TABLE(headers, rows, widths, mono_cols=(), caption=None):
    hexc = PARTS[_state['part']][0]
    data = [[Paragraph(h, S['th']) for h in headers]]
    for r in rows:
        data.append([Paragraph(str(c), S['tdc'] if i in mono_cols else S['td'])
                     for i, c in enumerate(r)])
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(hexc)),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.4, RULE),
        ('LINEBELOW', (0, 0), (-1, 0), 0.8, colors.HexColor(hexc)),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#f6f9fb')))
    t.setStyle(TableStyle(style))
    story.append(t)
    story.append(Paragraph(caption, S['caption']) if caption else Spacer(1, 11))


def FAQ(q, a):
    hexc = PARTS[_state['part']][0]
    block = [
        Paragraph('<font color="%s">Q.</font>&nbsp; %s' % (hexc, q), S['q']),
        Paragraph(a, S['body']),
    ]
    story.append(KeepTogether(block))
    story.append(Spacer(1, 3))


def STEP(n, title, body, code=None, note=None):
    hexc = PARTS[_state['part']][0]
    num = Table([[Paragraph(str(n), ParagraphStyle('sn', fontName='Helvetica-Bold',
                                                   fontSize=13, leading=15,
                                                   textColor=colors.white,
                                                   alignment=TA_CENTER))]],
                colWidths=[9 * mm], rowHeights=[9 * mm])
    num.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(hexc)),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    head = Table([[num, Paragraph(title, ParagraphStyle(
        'st', fontName='Helvetica-Bold', fontSize=11.4, leading=14.5, textColor=INK))]],
        colWidths=[12 * mm, 153 * mm])
    head.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(head)
    for para in body:
        story.append(Paragraph(para, ParagraphStyle('sb', parent=S['body'], leftIndent=12)))
    if code:
        CODE(code)
    if note:
        NOTE(note[0], note[1])
    story.append(Spacer(1, 7))


# ==========================================================================
#                               DOCUMENT
# ==========================================================================

def cover(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(colors.HexColor('#0b1620'))
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor('#0f6f8c'))
    canvas.rect(0, h - 10 * mm, w, 10 * mm, fill=1, stroke=0)
    for i, hexc in enumerate([p[0] for p in PARTS]):
        canvas.setFillColor(colors.HexColor(hexc))
        canvas.rect(22 * mm + i * 14 * mm, 52 * mm, 11 * mm, 3 * mm, fill=1, stroke=0)

    canvas.setFillColor(colors.white)
    canvas.setFont('Helvetica-Bold', 52)
    canvas.drawString(22 * mm, h - 92 * mm, 'NAZAR')
    canvas.setFont('Helvetica', 15.5)
    canvas.setFillColor(colors.HexColor('#9fc6d8'))
    canvas.drawString(22 * mm, h - 104 * mm, 'A field guide to how this website is built')
    canvas.setFont('Helvetica', 11)
    canvas.setFillColor(colors.HexColor('#7f9bad'))
    canvas.drawString(22 * mm, h - 115 * mm,
                      'and how to build one like it, starting from nothing')

    canvas.setStrokeColor(colors.HexColor('#24404f'))
    canvas.setLineWidth(0.8)
    canvas.line(22 * mm, h - 126 * mm, w - 22 * mm, h - 126 * mm)

    canvas.setFont('Helvetica', 9.6)
    canvas.setFillColor(colors.HexColor('#9fc6d8'))
    for i, line in enumerate([
        'A satellite tracker with no server, no database and no running costs.',
        'Every page, every globe and every calculation runs inside the reader’s browser.',
        'This guide explains all of it, assuming you have never written a line of code.',
    ]):
        canvas.drawString(22 * mm, h - 138 * mm - i * 6.4 * mm, line)

    canvas.setFont('Helvetica', 9)
    canvas.setFillColor(colors.HexColor('#5f7a8b'))
    canvas.drawString(22 * mm, 40 * mm, 'hitesh-gala.github.io/sat-orbit-map')
    canvas.drawString(22 * mm, 34 * mm, 'Source: github.com/Hitesh-Gala/sat-orbit-map')
    canvas.drawString(22 * mm, 24 * mm, 'Built %s' % BUILT)
    canvas.restoreState()


def part_page(idx):
    """Painter for part %d's divider page.

    The part has to be bound here, when the template is registered, not read
    from _state inside the painter.  _state is a COMPOSE-time variable: by the
    time anything is painted the story is fully built and it holds the last
    part for ever, so every page came out slate and captioned REFERENCE.
    """
    def paint(canvas, doc):
        canvas.saveState()
        w, h = A4
        hexc = PARTS[idx][0]
        canvas.setFillColor(colors.HexColor(hexc))
        canvas.rect(0, 0, w, h, fill=1, stroke=0)
        canvas.setFillColor(colors.Color(1, 1, 1, alpha=0.45))
        canvas.rect(22 * mm, h - 68 * mm, 26 * mm, 1.6 * mm, fill=1, stroke=0)
        canvas.restoreState()
    return paint


def main_page(idx):
    """Painter for the body pages of one part - band, running head, folio."""
    hexc, label = PARTS[idx]

    def paint(canvas, doc):
        canvas.saveState()
        w, h = A4
        canvas.setFillColor(colors.HexColor(hexc))
        canvas.rect(0, h - 6 * mm, w, 6 * mm, fill=1, stroke=0)

        canvas.setFont('Helvetica', 7.6)
        canvas.setFillColor(MUTED)
        canvas.drawString(22 * mm, h - 12.5 * mm, 'NAZAR · Field guide')
        canvas.drawRightString(w - 22 * mm, h - 12.5 * mm, label.upper())

        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(22 * mm, 16 * mm, w - 22 * mm, 16 * mm)
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(22 * mm, 11 * mm, 'hitesh-gala.github.io/sat-orbit-map')
        canvas.setFont('Helvetica-Bold', 8.6)
        canvas.setFillColor(colors.HexColor(hexc))
        canvas.drawRightString(w - 22 * mm, 11 * mm, str(canvas.getPageNumber()))
        canvas.restoreState()
    return paint


def plain_page(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(w - 22 * mm, 11 * mm, str(canvas.getPageNumber()))
    canvas.restoreState()


class Guide(BaseDocTemplate):
    def afterFlowable(self, flowable):
        lvl = getattr(flowable, 'toc_level', None)
        if lvl is not None:
            self.notify('TOCEntry', (lvl, flowable.toc_text, self.page))


def build():
    doc = Guide(OUT, pagesize=A4,
                leftMargin=22 * mm, rightMargin=22 * mm,
                topMargin=20 * mm, bottomMargin=20 * mm,
                title='NAZAR - A field guide to how this website is built',
                author='Hitesh Gala', subject='Code walkthrough and build guide',
                creator='scripts/gen_guide_pdf.py')
    frame = Frame(22 * mm, 20 * mm, A4[0] - 44 * mm, A4[1] - 40 * mm, id='f')
    doc.addPageTemplates([
        PageTemplate(id='cover', frames=[frame], onPage=cover),
        PageTemplate(id='plain', frames=[frame], onPage=plain_page),
    ])
    # One template pair per part, so the band, the running head and the folio
    # colour come from the template in use rather than from a shared variable.
    for i in range(len(PARTS)):
        doc.addPageTemplates([
            PageTemplate(id='part%d' % (i + 1),
                         frames=[Frame(22 * mm, 20 * mm, A4[0] - 44 * mm,
                                       A4[1] - 40 * mm, id='fp%d' % (i + 1))],
                         onPage=part_page(i)),
            PageTemplate(id='main%d' % (i + 1),
                         frames=[Frame(22 * mm, 20 * mm, A4[0] - 44 * mm,
                                       A4[1] - 40 * mm, id='fm%d' % (i + 1))],
                         onPage=main_page(i)),
        ])
    doc.multiBuild(story)


# ==========================================================================
#                               CONTENT
# ==========================================================================
from guide_content import compose  # noqa: E402  (same directory)

if __name__ == '__main__':
    if not os.path.isdir('docs'):
        sys.exit('run me from the repository root (no docs/ directory here)')
    compose(globals())
    build()
    print('wrote %s (%.0f KB)' % (OUT, os.path.getsize(OUT) / 1024))
