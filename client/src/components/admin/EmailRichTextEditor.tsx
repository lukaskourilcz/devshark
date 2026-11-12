import { useEffect } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useLanguage } from '../../i18n/LanguageContext';
import type { EmailDocument } from '../../../../shared/email-document';

/**
 * Structured authoring only (after the NAVIGYM administration): paragraphs, three heading levels,
 * lists, bold, italic and underline. The mail renderer, never pasted HTML, decides the markup sent.
 */
export default function EmailRichTextEditor({ initialDocument, onChange, labelId, helpId }: {
  initialDocument: EmailDocument;
  onChange: (document: EmailDocument) => void;
  labelId: string;
  helpId: string;
}) {
  const { t } = useLanguage();
  const editor = useEditor({
    extensions: [StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      blockquote: false, code: false, codeBlock: false, horizontalRule: false, strike: false, link: false,
    })],
    content: initialDocument,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': labelId, 'aria-describedby': helpId,
        class: 'admin-email-editor-content',
      },
    },
    // ProseMirror objects carry null prototypes; send plain JSON.
    onUpdate: ({ editor }) => onChange(JSON.parse(JSON.stringify(editor.getJSON())) as EmailDocument),
  });
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold') ?? false,
      italic: editor?.isActive('italic') ?? false,
      underline: editor?.isActive('underline') ?? false,
      bulletList: editor?.isActive('bulletList') ?? false,
      orderedList: editor?.isActive('orderedList') ?? false,
      heading: editor?.isActive('heading') ? String(editor.getAttributes('heading').level) : 'paragraph',
      undo: editor?.can().undo() ?? false,
      redo: editor?.can().redo() ?? false,
    }),
  });
  // A template switch, a save or a reset replaces the content. Typing never does, so the selection
  // and the undo history survive.
  useEffect(() => { editor?.commands.setContent(initialDocument, { emitUpdate: false }); }, [editor, initialDocument]);
  if (!editor) return <p role="status">{t('admin.emails.editorLoading')}</p>;
  const tool = (label: string, glyph: string, pressed: boolean | undefined, run: () => void, disabled = false) =>
    <button type="button" className="admin-email-tool" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={run}><span aria-hidden="true">{glyph}</span></button>;
  return <div className="admin-email-editor">
    <div className="admin-email-toolbar ss-compact" role="group" aria-label={t('admin.emails.formatting')}
      onMouseDown={event => { if (event.target instanceof Element && event.target.closest('button')) event.preventDefault(); }}>
      <select aria-label={t('admin.emails.textStyle')} value={active?.heading ?? 'paragraph'} onChange={event => {
        const value = event.target.value;
        if (value === 'paragraph') editor.chain().focus().setParagraph().run();
        else editor.chain().focus().setHeading({ level: Number(value) as 1 | 2 | 3 }).run();
      }}>
        <option value="paragraph">{t('admin.emails.paragraph')}</option>
        <option value="1">{t('admin.emails.heading').replace('{level}', '1')}</option>
        <option value="2">{t('admin.emails.heading').replace('{level}', '2')}</option>
        <option value="3">{t('admin.emails.heading').replace('{level}', '3')}</option>
      </select>
      {tool(t('admin.emails.bold'), 'B', active?.bold, () => editor.chain().focus().toggleBold().run())}
      {tool(t('admin.emails.italic'), 'I', active?.italic, () => editor.chain().focus().toggleItalic().run())}
      {tool(t('admin.emails.underline'), 'U', active?.underline, () => editor.chain().focus().toggleUnderline().run())}
      {tool(t('admin.emails.bulletList'), '•', active?.bulletList, () => editor.chain().focus().toggleBulletList().run())}
      {tool(t('admin.emails.orderedList'), '1.', active?.orderedList, () => editor.chain().focus().toggleOrderedList().run())}
      {tool(t('admin.emails.undo'), '↶', undefined, () => editor.chain().focus().undo().run(), !active?.undo)}
      {tool(t('admin.emails.redo'), '↷', undefined, () => editor.chain().focus().redo().run(), !active?.redo)}
    </div>
    <EditorContent editor={editor} />
  </div>;
}
