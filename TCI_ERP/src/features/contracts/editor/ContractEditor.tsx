/**
 * The contract editor: TipTap (open-source core, bundled, lazy-loaded with
 * this screen only) on the editor schema of extensions.ts, inside the same
 * page-like sheet as the viewer. It edits a working document and reports it
 * on every change; saving a VERSION is the page's business (an explicit
 * Save, with a change note).
 */

import { useEffect, useImperativeHandle, useMemo, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  Bold,
  Columns3,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Rows3,
  SeparatorHorizontal,
  Table as TableIcon,
  Type,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
} from 'lucide-react'

import { Select } from '../../../components/ui'
import { PLACEHOLDERS, placeholderKey } from '../../wording/catalogue'
import type { Placeholder } from '../../wording/catalogue'
import { contextValue } from '../mergeFields'
import type { ContractDoc } from '../model'
import { sheetStyle } from '../sheet'
import { contractExtensions } from './extensions'
import type { NumberingStorage } from './extensions'
import '../contractDoc.css'

export interface EditorHandle {
  /** Replaces the whole document (a restored working copy, a field refresh). */
  setDocument: (doc: ContractDoc) => void
  getDocument: () => ContractDoc
  scrollToBlock: (index: number) => void
  focus: () => void
}

interface ContractEditorProps {
  initial: ContractDoc
  /** fieldKey()s of fields whose source has moved. */
  stale: ReadonlySet<string>
  /** The printable context now, for inserting a field with its value. */
  context: Record<string, unknown> | null
  onChange: (doc: ContractDoc) => void
  ref?: Ref<EditorHandle>
}

/** Fields a person may insert: every single value (a limits row is a schedule
 * only a template generates). */
const INSERTABLE = PLACEHOLDERS.filter((p) => p !== 'limits' && !p.startsWith('limits.'))

type BlockStyle = 'paragraph' | 'clause' | 'title' | 'section' | 'heading'

function currentStyle(editor: Editor): BlockStyle {
  if (editor.isActive('heading', { level: 1 })) return 'title'
  if (editor.isActive('heading', { numbered: true })) return 'section'
  if (editor.isActive('heading')) return 'heading'
  if (editor.isActive('paragraph', { clause: true })) return 'clause'
  return 'paragraph'
}

function applyStyle(editor: Editor, style: BlockStyle) {
  const chain = editor.chain().focus()
  switch (style) {
    case 'title':
      chain.setNode('heading', { level: 1, numbered: false }).run()
      break
    case 'section':
      chain.setNode('heading', { level: 2, numbered: true }).run()
      break
    case 'heading':
      chain.setNode('heading', { level: 2, numbered: false }).run()
      break
    case 'clause':
      chain.setNode('paragraph', { clause: true }).run()
      break
    default:
      chain.setNode('paragraph', { clause: false }).run()
  }
}

export default function ContractEditor({ initial, stale, context, onChange, ref }: ContractEditorProps) {
  const { t } = useTranslation()
  const extensions = useMemo(() => contractExtensions(t('contractDrafts.editor.pageBreak')), [t])

  const editor = useEditor({
    extensions,
    content: initial as JSONContent,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: 'cdoc',
        'aria-label': t('contractDrafts.editor.area'),
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as ContractDoc),
  })

  // the stale set lives in the numbering extension's storage; a no-op
  // transaction redraws the decorations when it changes
  useEffect(() => {
    if (!editor) return
    const storage = (editor.storage as unknown as Record<string, NumberingStorage>).contractNumbering
    if (storage) storage.stale = stale
    editor.view.dispatch(editor.state.tr.setMeta('contractStale', true))
  }, [editor, stale])

  useImperativeHandle(
    ref,
    () => ({
      setDocument: (doc) => {
        editor?.commands.setContent(doc as JSONContent, { emitUpdate: true })
      },
      getDocument: () => (editor?.getJSON() ?? initial) as ContractDoc,
      scrollToBlock: (index) => {
        if (!editor) return
        let pos = -1
        editor.state.doc.forEach((_child, offset, i) => {
          if (i === index) pos = offset
        })
        if (pos < 0) return
        const dom = editor.view.nodeDOM(pos)
        if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
        editor.commands.setTextSelection(pos + 1)
      },
      focus: () => editor?.commands.focus(),
    }),
    [editor, initial],
  )

  if (!editor) return null
  return (
    <div className="flex flex-col gap-3">
      <Toolbar editor={editor} context={context} />
      <article className="cd-sheet" style={sheetStyle(initial.attrs?.layout)}>
        <EditorContent editor={editor} />
      </article>
    </div>
  )
}

function ToolButton({
  label,
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-accent-500 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4 ${
        active ? 'border-accent-600 bg-accent-50 text-accent-700' : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  )
}

const Divider = () => <span className="mx-1 h-6 w-px shrink-0 bg-slate-200" aria-hidden />

function Toolbar({ editor, context }: { editor: Editor; context: Record<string, unknown> | null }) {
  const { t } = useTranslation()
  const [field, setField] = useState('')
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: currentStyle(e),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      inTable: e.isActive('table'),
      bordered: e.getAttributes('table').bordered !== false,
      fieldSelected: e.isActive('mergeField'),
      align: (e.getAttributes(e.isActive('heading') ? 'heading' : 'paragraph').textAlign as string | null) ?? 'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  const insertField = (path: string) => {
    if (!path) return
    const value = context ? (contextValue(context, path, null) ?? '') : ''
    editor.chain().focus().insertContent({ type: 'mergeField', attrs: { path, index: null, value } }).run()
    setField('')
  }

  const fieldToText = () => {
    const { selection } = editor.state
    const node = editor.state.doc.nodeAt(selection.from)
    if (!node || node.type.name !== 'mergeField') return
    const value = String(node.attrs.value ?? '')
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        if (value) tr.replaceWith(selection.from, selection.from + node.nodeSize, editor.schema.text(value, node.marks))
        else tr.delete(selection.from, selection.from + node.nodeSize)
        return true
      })
      .run()
  }

  return (
    <div
      role="toolbar"
      aria-label={t('contractDrafts.editor.toolbar')}
      className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-lg border border-slate-200 bg-white/95 px-2 py-2 shadow-card backdrop-blur"
    >
      <ToolButton label={t('contractDrafts.editor.undo')} disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 />
      </ToolButton>
      <ToolButton label={t('contractDrafts.editor.redo')} disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 />
      </ToolButton>
      <Divider />
      <span className="inline-flex items-center gap-1 text-slate-500 [&_svg]:size-4">
        <Type aria-hidden />
        <Select
          aria-label={t('contractDrafts.editor.blockStyle')}
          value={state.style}
          onChange={(e) => applyStyle(editor, e.target.value as BlockStyle)}
          className="h-8 w-44! text-small"
        >
          {(['paragraph', 'clause', 'section', 'heading', 'title'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`contractDrafts.editor.styles.${s}`)}
            </option>
          ))}
        </Select>
      </span>
      <Divider />
      <ToolButton label={t('contractDrafts.editor.bold')} active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label={t('contractDrafts.editor.italic')} active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton
        label={t('contractDrafts.editor.underline')}
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon />
      </ToolButton>
      <Divider />
      {(
        [
          ['left', AlignLeft],
          ['center', AlignCenter],
          ['justify', AlignJustify],
        ] as const
      ).map(([align, Icon]) => (
        <ToolButton
          key={align}
          label={t(`contractDrafts.editor.align.${align}`)}
          active={state.align === align}
          onClick={() => editor.chain().focus().setTextAlign(align).run()}
        >
          <Icon />
        </ToolButton>
      ))}
      <Divider />
      <ToolButton label={t('contractDrafts.editor.bulletList')} active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List />
      </ToolButton>
      <ToolButton
        label={t('contractDrafts.editor.orderedList')}
        active={state.ordered}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolButton>
      <Divider />
      <ToolButton
        label={t('contractDrafts.editor.insertTable')}
        disabled={state.inTable}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <TableIcon />
      </ToolButton>
      <ToolButton label={t('contractDrafts.editor.addRow')} disabled={!state.inTable} onClick={() => editor.chain().focus().addRowAfter().run()}>
        <Rows3 />
      </ToolButton>
      <ToolButton
        label={t('contractDrafts.editor.addColumn')}
        disabled={!state.inTable}
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      >
        <Columns3 />
      </ToolButton>
      {/* always present (disabled outside a table): the toolbar never reflows */}
      <Select
          aria-label={t('contractDrafts.editor.tableMore')}
          disabled={!state.inTable}
          value=""
          onChange={(e) => {
            const v = e.target.value
            const c = editor.chain().focus()
            if (v === 'deleteRow') c.deleteRow().run()
            else if (v === 'deleteColumn') c.deleteColumn().run()
            else if (v === 'deleteTable') c.deleteTable().run()
            else if (v === 'borders') c.updateAttributes('table', { bordered: !state.bordered }).run()
          }}
          className="h-8 w-40! text-small"
        >
          <option value="">{t('contractDrafts.editor.tableMore')}</option>
          <option value="borders">{t(state.bordered ? 'contractDrafts.editor.bordersOff' : 'contractDrafts.editor.bordersOn')}</option>
          <option value="deleteRow">{t('contractDrafts.editor.deleteRow')}</option>
          <option value="deleteColumn">{t('contractDrafts.editor.deleteColumn')}</option>
          <option value="deleteTable">{t('contractDrafts.editor.deleteTable')}</option>
        </Select>
      <ToolButton label={t('contractDrafts.editor.pageBreak')} onClick={() => editor.chain().focus().insertContent({ type: 'pageBreak' }).run()}>
        <SeparatorHorizontal />
      </ToolButton>
      <Divider />
      <Select
        aria-label={t('contractDrafts.editor.insertField')}
        value={field}
        onChange={(e) => insertField(e.target.value)}
        className="h-8 w-52! text-small"
      >
        <option value="">{t('contractDrafts.editor.insertField')}</option>
        {INSERTABLE.map((p) => (
          <option key={p} value={p}>
            {t(placeholderKey(p as Placeholder))}
          </option>
        ))}
      </Select>
      <ToolButton label={t('contractDrafts.editor.fieldToText')} disabled={!state.fieldSelected} onClick={fieldToText}>
        <Unlink />
      </ToolButton>
    </div>
  )
}
