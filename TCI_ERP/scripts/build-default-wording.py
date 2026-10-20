#!/usr/bin/env python3
"""Build the standard policy wording templates (.docx) shipped with TCI ERP.

    python3 scripts/build-default-wording.py

Writes src/features/wording/defaults/policy-wording-{ru,en,uz}.docx. Python
standard library only (the .docx is assembled as WordprocessingML by hand), so
the output is reproducible and needs no extra install. The templates use the
placeholders of src/features/wording/catalogue.ts; an insurer installs them
from «Шаблоны договоров» and then replaces them with its own wording.

The text is a STARTING POINT for a draft contract, not legal advice: each
insurer adapts it to its own rules of insurance and its jurisdiction.
"""

import pathlib
import zipfile
from xml.sax.saxutils import escape

OUT = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'features' / 'wording' / 'defaults'

# ---------------------------------------------------------------------------
# Content. Blocks: ('title', text) ('subtitle', text) ('h', text) ('p', text)
# ('table', header_cells, row_cells) ('sign', left_lines, right_lines)
# Placeholders are written exactly as the catalogue defines them.
# ---------------------------------------------------------------------------

RU = [
    ('title', 'ДОГОВОР СТРАХОВАНИЯ ТОРГОВЫХ КРЕДИТОВ № {{policy.number}}'),
    ('subtitle', 'ПРОЕКТ · {{document.date}}'),
    ('p', '{{insurer.name}}, {{insurer.legal_form}}, лицензия № {{insurer.license_number}} от {{insurer.license_date}}, '
          'в лице {{insurer.signatory_title}} {{insurer.signatory_name}}, действующего на основании {{insurer.signatory_basis}}, '
          'именуемое в дальнейшем «Страховщик», с одной стороны, и {{policyholder.name}}, {{policyholder.legal_form}}, '
          'регистрационный номер {{policyholder.registration_number}}, именуемое в дальнейшем «Страхователь», с другой стороны, '
          'заключили настоящий договор о нижеследующем.'),
    ('h', '1. Предмет договора'),
    ('p', '1.1. Страховщик обязуется возместить Страхователю убытки, понесённые вследствие неоплаты байерами (покупателями) '
          'дебиторской задолженности за товары, работы и услуги, поставленные Страхователем на условиях отсрочки платежа, '
          'при наступлении страхового случая — неплатёжеспособности байера либо длительной неуплаты.'),
    ('p', '1.2. Структура покрытия: {{policy.product}}. Валюта договора: {{policy.currency}}.'),
    ('p', '1.3. Срок действия договора: с {{policy.inception_date}} по {{policy.expiry_date}} включительно.'),
    ('h', '2. Страховое покрытие'),
    ('p', '2.1. Застрахованная доля убытка: {{policy.insured_percentage}}.'),
    ('p', '2.2. Покрытие по каждому байеру ограничено кредитным лимитом, установленным Страховщиком (Приложение 1), '
          'либо дискреционным лимитом в размере {{policy.discretionary_limit}} {{policy.currency}} для байеров без кредитного лимита.'),
    ('p', '2.3. Максимальный срок отсрочки платежа по застрахованным поставкам: {{policy.max_payment_terms_days}} дней.'),
    ('p', '2.4. Не подлежащий возмещению убыток (NQL): убытки по одному байеру менее {{policy.nql_amount}} {{policy.currency}} не возмещаются.'),
    ('p', '{{#policy.deductible}}2.5. Франшиза по каждому убытку: {{policy.deductible}} {{policy.currency}}.{{/policy.deductible}}'),
    ('p', '{{#policy.aggregate_first_loss}}2.6. Агрегатная франшиза (первый риск Страхователя) за срок договора: {{policy.aggregate_first_loss}} {{policy.currency}}.{{/policy.aggregate_first_loss}}'),
    ('p', '2.7. Максимальная ответственность Страховщика по договору: {{policy.max_liability_amount}} {{policy.currency}}.'),
    ('h', '3. Страховая премия'),
    ('p', '3.1. Ставка премии: {{policy.premium_rate}} от застрахованного оборота, задекларированного Страхователем.'),
    ('p', '3.2. Минимальная премия за срок договора: {{policy.minimum_premium}} {{policy.currency}} ({{policy.premium_basis}}).'),
    ('p', '3.3. Страхователь представляет декларации оборота с периодичностью: {{policy.declaration_frequency}}.'),
    ('h', '4. Обязанности Страхователя'),
    ('p', '4.1. Страхователь уведомляет Страховщика о просрочке платежа байера не позднее {{policy.noa_window_days}} дней '
          'после истечения максимального срока продления ({{policy.max_extension_days}} дней) и прекращает поставки такому байеру '
          'на условиях отсрочки до согласования со Страховщиком.'),
    ('p', '4.2. Страхователь принимает разумные меры по взысканию задолженности и передаёт Страховщику права требования '
          'в пределах выплаченного возмещения (суброгация).'),
    ('h', '5. Урегулирование убытков'),
    ('p', '5.1. Возмещение выплачивается по истечении периода ожидания {{policy.waiting_period_days}} дней с даты уведомления '
          'о длительной неуплате либо после документального подтверждения неплатёжеспособности байера.'),
    ('p', '5.2. Взысканные после выплаты суммы распределяются между Страховщиком и Страхователем пропорционально понесённым ими убыткам.'),
    ('h', '6. Прочие условия'),
    ('p', '6.1. Во всём, что не урегулировано настоящим договором, стороны руководствуются правилами страхования Страховщика '
          'и применимым законодательством.'),
    ('h', 'Реквизиты и подписи сторон'),
    ('sign',
     ['Страховщик', '{{insurer.name}}', '{{insurer.address}}', 'ИНН: {{insurer.tax_id}}',
      'Банк: {{insurer.bank_name}}', 'Счёт: {{insurer.bank_account}}, код: {{insurer.bank_code}}',
      '', '{{insurer.signatory_title}} _______________ {{insurer.signatory_name}}'],
     ['Страхователь', '{{policyholder.name}}', '{{policyholder.address}}',
      'Рег. №: {{policyholder.registration_number}}', '{{policyholder.email}} {{policyholder.phone}}',
      '', '', '_______________ {{policyholder.contact_person}}']),
    ('pagebreak',),
    ('h', 'Приложение 1. Кредитные лимиты'),
    ('table',
     ['Байер', 'Страна', 'Рег. №', 'Лимит', 'Валюта', 'Отсрочка, дней', 'Действует с', 'по'],
     ['{{#limits}}{{buyer_name}}', '{{buyer_country}}', '{{buyer_registration_number}}', '{{amount}}', '{{currency}}',
      '{{payment_terms_days}}', '{{valid_from}}', '{{valid_until}}{{/limits}}']),
]

EN = [
    ('title', 'TRADE CREDIT INSURANCE POLICY No. {{policy.number}}'),
    ('subtitle', 'DRAFT · {{document.date}}'),
    ('p', '{{insurer.name}}, {{insurer.legal_form}}, licence No. {{insurer.license_number}} dated {{insurer.license_date}}, '
          'represented by {{insurer.signatory_title}} {{insurer.signatory_name}}, acting under {{insurer.signatory_basis}} '
          '(the "Insurer"), and {{policyholder.name}}, {{policyholder.legal_form}}, registration number '
          '{{policyholder.registration_number}} (the "Policyholder"), agree as follows.'),
    ('h', '1. Subject of the policy'),
    ('p', '1.1. The Insurer shall indemnify the Policyholder for losses arising from the non-payment by buyers of receivables '
          'for goods, works and services supplied by the Policyholder on credit terms, when an insured event occurs: '
          'the insolvency of the buyer or its protracted default.'),
    ('p', '1.2. Cover structure: {{policy.product}}. Policy currency: {{policy.currency}}.'),
    ('p', '1.3. Period of insurance: from {{policy.inception_date}} to {{policy.expiry_date}} inclusive.'),
    ('h', '2. Cover'),
    ('p', '2.1. Insured percentage: {{policy.insured_percentage}}.'),
    ('p', '2.2. Cover on each buyer is limited to the credit limit set by the Insurer (Schedule 1) or, for a buyer without a '
          'credit limit, to the discretionary limit of {{policy.discretionary_limit}} {{policy.currency}}.'),
    ('p', '2.3. Maximum credit period on insured supplies: {{policy.max_payment_terms_days}} days.'),
    ('p', '2.4. Non-qualifying loss (NQL): a loss on one buyer below {{policy.nql_amount}} {{policy.currency}} is not indemnified.'),
    ('p', '{{#policy.deductible}}2.5. Deductible each loss: {{policy.deductible}} {{policy.currency}}.{{/policy.deductible}}'),
    ('p', '{{#policy.aggregate_first_loss}}2.6. Aggregate first loss for the period of insurance: {{policy.aggregate_first_loss}} {{policy.currency}}.{{/policy.aggregate_first_loss}}'),
    ('p', '2.7. Maximum liability of the Insurer under this policy: {{policy.max_liability_amount}} {{policy.currency}}.'),
    ('h', '3. Premium'),
    ('p', '3.1. Premium rate: {{policy.premium_rate}} of the insured turnover declared by the Policyholder.'),
    ('p', '3.2. Minimum premium for the period of insurance: {{policy.minimum_premium}} {{policy.currency}} ({{policy.premium_basis}}).'),
    ('p', '3.3. The Policyholder submits turnover declarations: {{policy.declaration_frequency}}.'),
    ('h', '4. Obligations of the Policyholder'),
    ('p', '4.1. The Policyholder notifies the Insurer of a buyer\'s overdue payment no later than {{policy.noa_window_days}} days '
          'after the maximum extension period ({{policy.max_extension_days}} days) has expired, and stops supplying that buyer '
          'on credit terms until agreed with the Insurer.'),
    ('p', '4.2. The Policyholder takes all reasonable steps to recover the debt and assigns its rights of recovery to the '
          'Insurer to the extent of the indemnity paid (subrogation).'),
    ('h', '5. Claims'),
    ('p', '5.1. The indemnity is paid after a waiting period of {{policy.waiting_period_days}} days from the notification of '
          'protracted default, or once the buyer\'s insolvency is established.'),
    ('p', '5.2. Recoveries after payment are shared between the Insurer and the Policyholder in proportion to the loss each bore.'),
    ('h', '6. General'),
    ('p', '6.1. Anything not provided for in this policy is governed by the Insurer\'s rules of insurance and the applicable law.'),
    ('h', 'Particulars and signatures'),
    ('sign',
     ['Insurer', '{{insurer.name}}', '{{insurer.address}}', 'Tax ID: {{insurer.tax_id}}',
      'Bank: {{insurer.bank_name}}', 'Account: {{insurer.bank_account}}, code: {{insurer.bank_code}}',
      '', '{{insurer.signatory_title}} _______________ {{insurer.signatory_name}}'],
     ['Policyholder', '{{policyholder.name}}', '{{policyholder.address}}',
      'Reg. No.: {{policyholder.registration_number}}', '{{policyholder.email}} {{policyholder.phone}}',
      '', '', '_______________ {{policyholder.contact_person}}']),
    ('pagebreak',),
    ('h', 'Schedule 1. Credit limits'),
    ('table',
     ['Buyer', 'Country', 'Reg. No.', 'Limit', 'Currency', 'Credit period, days', 'Valid from', 'until'],
     ['{{#limits}}{{buyer_name}}', '{{buyer_country}}', '{{buyer_registration_number}}', '{{amount}}', '{{currency}}',
      '{{payment_terms_days}}', '{{valid_from}}', '{{valid_until}}{{/limits}}']),
]

UZ = [
    ('title', 'SAVDO KREDITLARINI SUG‘URTALASH SHARTNOMASI № {{policy.number}}'),
    ('subtitle', 'LOYIHA · {{document.date}}'),
    ('p', '{{insurer.name}}, {{insurer.legal_form}}, {{insurer.license_date}} sanadagi {{insurer.license_number}}-sonli litsenziya, '
          '{{insurer.signatory_basis}} asosida faoliyat yurituvchi {{insurer.signatory_title}} {{insurer.signatory_name}} timsolida, '
          'bundan buyon «Sug‘urtalovchi» deb ataladi, bir tomondan, va {{policyholder.name}}, {{policyholder.legal_form}}, '
          'ro‘yxatdan o‘tish raqami {{policyholder.registration_number}}, bundan buyon «Sug‘urtalanuvchi» deb ataladi, ikkinchi tomondan, '
          'quyidagilar haqida ushbu shartnomani tuzdilar.'),
    ('h', '1. Shartnoma predmeti'),
    ('p', '1.1. Sug‘urtalovchi Sug‘urtalanuvchiga u to‘lovni kechiktirish shartlarida yetkazib bergan tovarlar, ishlar va xizmatlar '
          'uchun bayerlar tomonidan debitorlik qarzi to‘lanmasligi natijasida ko‘rilgan zararni sug‘urta hodisasi — bayerning '
          'to‘lovga qobiliyatsizligi yoki uzoq muddatli to‘lamaslik yuz berganda qoplash majburiyatini oladi.'),
    ('p', '1.2. Qoplash tuzilmasi: {{policy.product}}. Shartnoma valyutasi: {{policy.currency}}.'),
    ('p', '1.3. Shartnomaning amal qilish muddati: {{policy.inception_date}}dan {{policy.expiry_date}}gacha (shu kun ham kiradi).'),
    ('h', '2. Sug‘urta qoplamasi'),
    ('p', '2.1. Zararning sug‘urtalangan ulushi: {{policy.insured_percentage}}.'),
    ('p', '2.2. Har bir bayer bo‘yicha qoplama Sug‘urtalovchi belgilagan kredit limiti (1-ilova) bilan, kredit limiti bo‘lmagan '
          'bayerlar uchun esa {{policy.discretionary_limit}} {{policy.currency}} miqdoridagi diskretsion limit bilan cheklanadi.'),
    ('p', '2.3. Sug‘urtalangan yetkazib berishlar bo‘yicha to‘lovni kechiktirishning eng uzoq muddati: {{policy.max_payment_terms_days}} kun.'),
    ('p', '2.4. Qoplanmaydigan zarar (NQL): bitta bayer bo‘yicha {{policy.nql_amount}} {{policy.currency}}dan kam zarar qoplanmaydi.'),
    ('p', '{{#policy.deductible}}2.5. Har bir zarar bo‘yicha franshiza: {{policy.deductible}} {{policy.currency}}.{{/policy.deductible}}'),
    ('p', '{{#policy.aggregate_first_loss}}2.6. Shartnoma muddati uchun agregat franshiza: {{policy.aggregate_first_loss}} {{policy.currency}}.{{/policy.aggregate_first_loss}}'),
    ('p', '2.7. Sug‘urtalovchining shartnoma bo‘yicha eng yuqori javobgarligi: {{policy.max_liability_amount}} {{policy.currency}}.'),
    ('h', '3. Sug‘urta mukofoti'),
    ('p', '3.1. Mukofot stavkasi: Sug‘urtalanuvchi e’lon qilgan sug‘urtalangan aylanmaning {{policy.premium_rate}}.'),
    ('p', '3.2. Shartnoma muddati uchun minimal mukofot: {{policy.minimum_premium}} {{policy.currency}} ({{policy.premium_basis}}).'),
    ('p', '3.3. Sug‘urtalanuvchi aylanma deklaratsiyalarini quyidagi davriylikda taqdim etadi: {{policy.declaration_frequency}}.'),
    ('h', '4. Sug‘urtalanuvchining majburiyatlari'),
    ('p', '4.1. Sug‘urtalanuvchi bayer to‘lovi muddati o‘tganligi haqida eng uzoq uzaytirish muddati ({{policy.max_extension_days}} kun) '
          'tugaganidan keyin {{policy.noa_window_days}} kundan kechiktirmay Sug‘urtalovchiga xabar beradi va Sug‘urtalovchi bilan '
          'kelishilgunga qadar ushbu bayerga kechiktirilgan to‘lov shartlarida yetkazib berishni to‘xtatadi.'),
    ('p', '4.2. Sug‘urtalanuvchi qarzni undirish uchun oqilona choralar ko‘radi va to‘langan qoplama doirasida talab huquqlarini '
          'Sug‘urtalovchiga o‘tkazadi (subrogatsiya).'),
    ('h', '5. Zararlarni tartibga solish'),
    ('p', '5.1. Qoplama uzoq muddatli to‘lamaslik haqida xabar berilgan sanadan boshlab {{policy.waiting_period_days}} kunlik kutish '
          'davri o‘tgach yoki bayerning to‘lovga qobiliyatsizligi hujjatlar bilan tasdiqlangach to‘lanadi.'),
    ('p', '5.2. To‘lovdan keyin undirilgan summalar Sug‘urtalovchi va Sug‘urtalanuvchi o‘rtasida ular ko‘rgan zararga mutanosib taqsimlanadi.'),
    ('h', '6. Boshqa shartlar'),
    ('p', '6.1. Ushbu shartnomada nazarda tutilmagan barcha masalalarda tomonlar Sug‘urtalovchining sug‘urta qoidalari va amaldagi '
          'qonunchilikka amal qiladilar.'),
    ('h', 'Tomonlarning rekvizitlari va imzolari'),
    ('sign',
     ['Sug‘urtalovchi', '{{insurer.name}}', '{{insurer.address}}', 'STIR: {{insurer.tax_id}}',
      'Bank: {{insurer.bank_name}}', 'Hisob raqami: {{insurer.bank_account}}, kod: {{insurer.bank_code}}',
      '', '{{insurer.signatory_title}} _______________ {{insurer.signatory_name}}'],
     ['Sug‘urtalanuvchi', '{{policyholder.name}}', '{{policyholder.address}}',
      'Ro‘yxat raqami: {{policyholder.registration_number}}', '{{policyholder.email}} {{policyholder.phone}}',
      '', '', '_______________ {{policyholder.contact_person}}']),
    ('pagebreak',),
    ('h', '1-ilova. Kredit limitlari'),
    ('table',
     ['Bayer', 'Mamlakat', 'Ro‘yxat raqami', 'Limit', 'Valyuta', 'Kechiktirish, kun', 'Amal qiladi', 'gacha'],
     ['{{#limits}}{{buyer_name}}', '{{buyer_country}}', '{{buyer_registration_number}}', '{{amount}}', '{{currency}}',
      '{{payment_terms_days}}', '{{valid_from}}', '{{valid_until}}{{/limits}}']),
]

# ---------------------------------------------------------------------------
# WordprocessingML
# ---------------------------------------------------------------------------

def run(text, bold=False, size=None):
    props = ''
    if bold or size:
        props = '<w:rPr>' + ('<w:b/>' if bold else '') + (f'<w:sz w:val="{size}"/>' if size else '') + '</w:rPr>'
    return f'<w:r>{props}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def para(text, bold=False, size=None, align=None, space_after=120):
    ppr = f'<w:pPr><w:spacing w:after="{space_after}"/>' + (f'<w:jc w:val="{align}"/>' if align else '') + '</w:pPr>'
    return f'<w:p>{ppr}{run(text, bold, size)}</w:p>'


def cell(text, bold=False, width=None):
    tcpr = f'<w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr>' if width else '<w:tcPr/>'
    return f'<w:tc>{tcpr}{para(text, bold=bold, size=18, space_after=0)}</w:tc>'


def table(header, row, widths=None):
    borders = ''.join(f'<w:{b} w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
                      for b in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
    out = f'<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>{borders}</w:tblBorders></w:tblPr>'
    out += '<w:tr>' + ''.join(cell(h, bold=True) for h in header) + '</w:tr>'
    out += '<w:tr>' + ''.join(cell(c) for c in row) + '</w:tr>'
    return out + '</w:tbl>'


def signatures(left, right):
    out = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tr>'
    for lines in (left, right):
        body = ''.join(para(line, bold=(i == 0), size=20, space_after=40) for i, line in enumerate(lines))
        out += f'<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>{body}</w:tc>'
    return out + '</w:tr></w:tbl>'


def document(blocks):
    body = []
    for block in blocks:
        kind = block[0]
        if kind == 'title':
            body.append(para(block[1], bold=True, size=28, align='center'))
        elif kind == 'subtitle':
            body.append(para(block[1], size=20, align='center', space_after=240))
        elif kind == 'h':
            body.append(para(block[1], bold=True, size=22, space_after=80))
        elif kind == 'p':
            body.append(para(block[1], size=21, align='both'))
        elif kind == 'table':
            body.append(table(block[1], block[2]))
        elif kind == 'sign':
            body.append(signatures(block[1], block[2]))
        elif kind == 'pagebreak':
            body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    sect = ('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/>'
            '</w:sectPr>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f'<w:body>{"".join(body)}{sect}</w:body></w:document>')


STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
          '<w:docDefaults><w:rPrDefault><w:rPr>'
          '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="21"/>'
          '<w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>')

CONTENT_TYPES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                 '<Default Extension="xml" ContentType="application/xml"/>'
                 '<Override PartName="/word/document.xml" '
                 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                 '<Override PartName="/word/styles.xml" '
                 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                 '</Types>')

ROOT_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" '
             'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
             'Target="word/document.xml"/></Relationships>')

DOC_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
            'Target="styles.xml"/></Relationships>')


def write(name, blocks):
    path = OUT / f'policy-wording-{name}.docx'
    # Fixed timestamps: the file is byte-identical on every build.
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for arc, data in (('[Content_Types].xml', CONTENT_TYPES), ('_rels/.rels', ROOT_RELS),
                          ('word/_rels/document.xml.rels', DOC_RELS), ('word/styles.xml', STYLES),
                          ('word/document.xml', document(blocks))):
            info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    print(path.relative_to(OUT.parent.parent.parent.parent), path.stat().st_size, 'bytes')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    write('ru', RU)
    write('en', EN)
    write('uz', UZ)
