/**
 * The editor's schema on top of TipTap's open-source core (StarterKit,
 * tables, text alignment): what model.ts describes, and nothing a contract
 * does not need (no code, links, quotes, strike-through or rules).
 *
 *   mergeField   an inline atom chip: path, row index, the printed value
 *   pageBreak    a block atom
 *   clause / numbered / bordered / layout   attributes on paragraph,
 *                heading, table and doc
 *   numbering    decorations that draw the derived clause numbers, and the
 *                amber ring on fields whose source has moved
 */

import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PmNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'

import { fieldKey } from '../mergeFields'
import { blockKind, numberLabels } from '../numbering'

export const MergeField = Node.create({
  name: 'mergeField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      path: { default: '' },
      index: { default: null },
      value: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-merge-path]',
        getAttrs: (el) => {
          const e = el as HTMLElement
          const index = e.getAttribute('data-merge-index')
          return {
            path: e.getAttribute('data-merge-path') ?? '',
            index: index === null || index === '' ? null : Number(index),
            value: e.textContent ?? '',
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const value = String(node.attrs.value ?? '')
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: `cd-field${value ? '' : ' cd-field-empty'}`,
        'data-merge-path': node.attrs.path,
        'data-merge-index': node.attrs.index ?? '',
        'data-path': node.attrs.path,
        title: node.attrs.path,
      }),
      value,
    ]
  },

  renderText({ node }) {
    return String(node.attrs.value ?? '')
  },
})

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return { label: '' }
  },

  parseHTML() {
    return [{ tag: 'hr.cd-pagebreak' }]
  },

  renderHTML() {
    return ['hr', { class: 'cd-pagebreak', 'data-label': this.options.label }]
  },
})

/** clause / numbered / bordered / layout as attributes of existing nodes. */
export const ContractAttributes = Extension.create({
  name: 'contractAttributes',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          clause: {
            default: false,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-clause') === 'true',
            renderHTML: (attrs: Record<string, unknown>) => (attrs.clause ? { 'data-clause': 'true' } : {}),
          },
        },
      },
      {
        types: ['heading'],
        attributes: {
          numbered: {
            default: false,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-numbered') === 'true',
            renderHTML: (attrs: Record<string, unknown>) => (attrs.numbered ? { 'data-numbered': 'true' } : {}),
          },
        },
      },
      {
        types: ['table'],
        attributes: {
          bordered: {
            default: true,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-bordered') !== 'false',
            renderHTML: (attrs: Record<string, unknown>) => ({ 'data-bordered': attrs.bordered ? 'true' : 'false' }),
          },
        },
      },
      {
        types: ['doc'],
        attributes: { layout: { default: null, rendered: false } },
      },
    ]
  },
})

export interface NumberingStorage {
  stale: ReadonlySet<string>
}

export const numberingKey = new PluginKey('contractNumbering')

function decorate(doc: PmNode, stale: ReadonlySet<string>): DecorationSet {
  const decorations: Decoration[] = []
  const kinds: ReturnType<typeof blockKind>[] = []
  const positions: number[] = []
  doc.forEach((child, offset) => {
    kinds.push(blockKind({ type: child.type.name, attrs: child.attrs }))
    positions.push(offset)
  })
  numberLabels(kinds).forEach((label, i) => {
    if (!label) return
    decorations.push(
      Decoration.widget(
        positions[i]! + 1,
        () => {
          const span = document.createElement('span')
          span.className = 'cd-num'
          span.textContent = label
          span.contentEditable = 'false'
          return span
        },
        { side: -1, key: `n-${i}-${label}`, ignoreSelection: true },
      ),
    )
  })
  if (stale.size) {
    doc.descendants((node, pos) => {
      if (node.type.name === 'mergeField' && stale.has(fieldKey({ path: node.attrs.path, index: node.attrs.index ?? null }))) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'cd-field-stale' }))
      }
    })
  }
  return DecorationSet.create(doc, decorations)
}

/** Derived numbers and stale-field rings, recomputed on every change — the
 * same numberLabels() the viewer and the export use. */
export const ContractNumbering = Extension.create<Record<string, never>, NumberingStorage>({
  name: 'contractNumbering',
  addStorage() {
    return { stale: new Set<string>() }
  },
  addProseMirrorPlugins() {
    const storage = this.storage
    return [
      new Plugin({
        key: numberingKey,
        props: {
          decorations: (state) => decorate(state.doc, storage.stale),
        },
      }),
    ]
  },
})

export function contractExtensions(pageBreakLabel: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      blockquote: false,
      strike: false,
      horizontalRule: false,
      link: false,
      trailingNode: false,
    }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    MergeField,
    PageBreak.configure({ label: pageBreakLabel }),
    ContractAttributes,
    ContractNumbering,
  ]
}
