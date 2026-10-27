import { describe, expect, it } from 'vitest'

import { batches, guessList, ListFormatError, parseCsv, parseEu, parseOfacSdn, parseSimpleCsv, parseUk, parseUn } from './parse'

// Excerpts in the publishers' own formats (abridged, the shapes kept).
const SDN = [
  '36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
  '306,"BANCO NACIONAL DE CUBA",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"a.k.a. \'BNC\'."',
  '7351,"PETROV, Ivan",individual,"RUSSIA-EO14024] [UKRAINE-EO13660",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 12 Jan 1961; nationality Russia; Gender Male."',
  '9001,"OCEAN STAR",vessel,"IRAN",-0- ,-0- ,"Crude Oil Tanker",-0- ,-0- ,-0- ,-0- ,-0- ',
].join('\n')
const ALT = ['36,12,"aka","AERO-CARIBBEAN",-0- ', '7351,99,"aka","PETROV, Ivan Ivanovich",-0- '].join('\n')

const UN = `<?xml version="1.0" encoding="UTF-8"?>
<CONSOLIDATED_LIST dateGenerated="2026-10-26T23:00:02.307Z">
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>6907994</DATAID>
      <FIRST_NAME>FRANK KAKOLELE</FIRST_NAME>
      <SECOND_NAME>BWAMBALE</SECOND_NAME>
      <UN_LIST_TYPE>DRC</UN_LIST_TYPE>
      <REFERENCE_NUMBER>CDi.002</REFERENCE_NUMBER>
      <LISTED_ON>2005-11-01</LISTED_ON>
      <NATIONALITY><VALUE>Democratic Republic of the Congo</VALUE></NATIONALITY>
      <INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>FRANK KAKORERE</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_ALIAS><QUALITY/><ALIAS_NAME/></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_DATE_OF_BIRTH><TYPE_OF_DATE>EXACT</TYPE_OF_DATE><YEAR>1971</YEAR></INDIVIDUAL_DATE_OF_BIRTH>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES>
    <ENTITY>
      <DATAID>6908402</DATAID>
      <FIRST_NAME>ADF &amp; Co</FIRST_NAME>
      <UN_LIST_TYPE>DRC</UN_LIST_TYPE>
      <REFERENCE_NUMBER>CDe.001</REFERENCE_NUMBER>
      <LISTED_ON>2014-06-30</LISTED_ON>
      <ENTITY_ALIAS><ALIAS_NAME>Allied Democratic Forces</ALIAS_NAME></ENTITY_ALIAS>
      <ENTITY_ADDRESS><COUNTRY>Uganda</COUNTRY></ENTITY_ADDRESS>
    </ENTITY>
  </ENTITIES>
</CONSOLIDATED_LIST>`

const EU_HEAD =
  'fileGenerationDate;Entity_LogicalId;Entity_EU_ReferenceNumber;Entity_SubjectType_ClassificationCode;Entity_Regulation_Programme;Entity_Regulation_PublicationDate;Entity_Remark;NameAlias_WholeName;Address_CountryDescription;BirthDate_BirthDate;BirthDate_Year;Citizenship_CountryDescription'
const EU = [
  `\uFEFF${EU_HEAD}`,
  '23/10/2026;13;EU.27.28;person;IRQ;2003-07-08;(Saddam);Saddam Hussein Al-Tikriti;;1937-04-28;;IRAQ',
  '23/10/2026;13;EU.27.28;person;IRQ;2003-07-08;(Saddam);Abu Ali;;;;',
  '23/10/2026;20;EU.1.1;enterprise;RUS;2022-03-01;;"Bank ""Rossiya""";RUSSIAN FEDERATION;;;',
].join('\n')

const UK = [
  'Report Date: 27-Oct-2026',
  'Last Updated,Unique ID,Name 6,Name 1,Name 2,Name 3,Name 4,Name 5,Name type,Name non-latin script,Regime Name,Designation Type,D.O.B,Nationality(/ies),Address Country,Date Designated,Other Information',
  '04/08/2026,RUS0001,SECHIN,Igor,Ivanovich,,,,Primary Name,Игорь Иванович СЕЧИН,The Russia Regulations,Individual,07/09/1960,Russia,,24/02/2022,CEO of Rosneft',
  '04/08/2026,RUS0001,SETCHIN,Igor,,,,,Alias,,The Russia Regulations,Individual,07/09/1960,Russia,,24/02/2022,CEO of Rosneft',
  '04/08/2026,RUS0002,ROSNEFT,,,,,,Primary Name,,The Russia Regulations,Entity,,,Russia,24/02/2022,',
].join('\n')

describe('CSV', () => {
  it('reads quoted fields, doubled quotes and any line ending', () => {
    expect(parseCsv('a,"b ""c""",d\r\n1,"x\ny",3\n', ',')).toEqual([
      ['a', 'b "c"', 'd'],
      ['1', 'x\ny', '3'],
    ])
    expect(parseCsv('a;b\n\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('OFAC SDN', () => {
  it('reads parties, kinds, programmes, birth dates and the aliases file', () => {
    const l = parseOfacSdn(SDN, ALT)
    expect(l.list).toBe('ofac_sdn')
    expect(l.publishedAt).toBeNull()
    expect(l.entries.map((e) => [e.ref, e.kind])).toEqual([
      ['36', 'entity'],
      ['306', 'entity'],
      ['7351', 'person'],
      ['9001', 'vessel'],
    ])
    const petrov = l.entries.find((e) => e.ref === '7351')!
    expect(petrov.names).toEqual([
      { n: 'PETROV, Ivan', p: true },
      { n: 'PETROV, Ivan Ivanovich', p: false },
    ])
    expect(petrov.programmes).toEqual(['RUSSIA-EO14024', 'UKRAINE-EO13660'])
    expect(petrov.birth_dates).toEqual(['12 Jan 1961'])
    expect(petrov.countries).toEqual(['Russia'])
    expect(l.entries[0]!.names.map((n) => n.n)).toEqual(['AEROCARIBBEAN AIRLINES', 'AERO-CARIBBEAN'])
  })

  it('refuses an aliases file of another list, and a file that is not SDN', () => {
    expect(() => parseOfacSdn(SDN, '1,2,"aka","X",-0- ')).toThrow(ListFormatError)
    expect(() => parseOfacSdn('hello,world', null)).toThrow(ListFormatError)
  })
})

describe('UN consolidated list', () => {
  it('reads people and entities, aliases, nationality and the list date', () => {
    const l = parseUn(UN)
    expect(l.publishedAt).toBe('2026-10-26')
    const [frank, adf] = l.entries
    expect(frank).toMatchObject({ ref: 'CDi.002', kind: 'person', listed_on: '2005-11-01', programmes: ['DRC'], birth_dates: ['1971'] })
    expect(frank!.names).toEqual([
      { n: 'FRANK KAKOLELE BWAMBALE', p: true },
      { n: 'FRANK KAKORERE', p: false },
    ])
    expect(frank!.countries).toEqual(['Democratic Republic of the Congo'])
    expect(adf).toMatchObject({ ref: 'CDe.001', kind: 'entity', countries: ['Uganda'] })
    expect(adf!.names[0]).toEqual({ n: 'ADF & Co', p: true })
  })

  it('refuses another XML', () => {
    expect(() => parseUn('<root/>')).toThrow(ListFormatError)
  })
})

describe('EU consolidated list', () => {
  it('groups the rows of one party, keeps every name, reads the file date', () => {
    const l = parseEu(EU)
    expect(l.publishedAt).toBe('2026-10-23')
    expect(l.entries).toHaveLength(2)
    expect(l.entries[0]).toMatchObject({
      ref: 'EU.27.28',
      kind: 'person',
      programmes: ['IRQ'],
      birth_dates: ['1937-04-28'],
      countries: ['IRAQ'],
      listed_on: '2003-07-08',
    })
    expect(l.entries[0]!.names).toEqual([
      { n: 'Saddam Hussein Al-Tikriti', p: true },
      { n: 'Abu Ali', p: false },
    ])
    expect(l.entries[1]).toMatchObject({ ref: 'EU.1.1', kind: 'entity', names: [{ n: 'Bank "Rossiya"', p: true }] })
  })

  it('refuses a CSV without the EU columns', () => {
    expect(() => parseEu('a;b\n1;2')).toThrow(ListFormatError)
  })
})

describe('UK Sanctions List', () => {
  it('joins the name parts, groups by the unique id, keeps the non-Latin name, reads the report date', () => {
    const l = parseUk(UK)
    expect(l.publishedAt).toBe('2026-10-27')
    expect(l.entries).toHaveLength(2)
    expect(l.entries[0]).toMatchObject({ ref: 'RUS0001', kind: 'person', listed_on: '2022-02-24', birth_dates: ['07/09/1960'] })
    expect(l.entries[0]!.names).toEqual([
      { n: 'Igor Ivanovich SECHIN', p: true },
      { n: 'Игорь Иванович СЕЧИН', p: false },
      { n: 'Igor SETCHIN', p: false },
    ])
    expect(l.entries[1]).toMatchObject({ ref: 'RUS0002', kind: 'entity', names: [{ n: 'ROSNEFT', p: true }] })
  })
})

describe('another list (OpenSanctions simple CSV)', () => {
  it('reads the schema, the aliases and the sanctions', () => {
    const l = parseSimpleCsv(
      'id,schema,name,aliases,birth_date,countries,addresses,identifiers,sanctions,phones,emails,dataset,first_seen\n' +
        'NK-1,Company,"Alpha Trade LLC","Alfa Treyd;Альфа Трейд",,uz,,,"National list",,,x,2026-01-02T10:00:00\n' +
        'NK-2,Person,"Petrov Ivan",,1961-01-12,ru,,,,,,x,2026-01-02T10:00:00\n',
    )
    expect(l.entries.map((e) => [e.ref, e.kind, e.names.length])).toEqual([
      ['NK-1', 'entity', 3],
      ['NK-2', 'person', 1],
    ])
    expect(l.entries[0]!.listed_on).toBe('2026-01-02')
  })
})

describe('guessing and batching', () => {
  it('suggests the list from the file’s first bytes', () => {
    expect(guessList('consolidated.xml', '<?xml version="1.0"?><CONSOLIDATED_LIST ')).toBe('un')
    expect(guessList('x.csv', '\uFEFFfileGenerationDate;Entity_LogicalId')).toBe('eu')
    expect(guessList('x.csv', 'Report Date: 27-Oct-2026')).toBe('uk')
    expect(guessList('sdn.csv', '36,"AEROCARIBBEAN AIRLINES",')).toBe('ofac_sdn')
    expect(guessList('t.csv', 'id,schema,name,aliases')).toBe('other')
    expect(guessList('t.txt', 'hello')).toBeNull()
  })

  it('cuts batches by count and by size, never empty, keeping order', () => {
    const entries = Array.from({ length: 1201 }, (_, i) => ({
      ref: String(i),
      kind: 'entity' as const,
      names: [{ n: `N${i}`, p: true }],
      programmes: [],
      countries: [],
      birth_dates: [],
      listed_on: null,
      remarks: null,
    }))
    const b = batches(entries)
    expect(b.map((x) => x.length)).toEqual([500, 500, 201])
    expect(b.flat().map((e) => e.ref)).toEqual(entries.map((e) => e.ref))
    expect(batches(entries, 1000, 2000).every((x) => JSON.stringify(x).length <= 2200)).toBe(true)
    expect(batches([])).toEqual([])
  })
})
