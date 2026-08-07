import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { padDocumentToPlainText, sanitizePastedPadHtml } from '../lib/padSchema.js';

export const PAD_TEXT_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#38bdf8', '#a78bfa'];

export function buildPadExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2] },
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      link: false,
      strike: false,
      underline: false,
    }),
    Underline,
    TextStyle,
    Color.configure({ types: ['textStyle'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
  ];
}

export default function PadEditor({ activePad, onDocumentChange, onEditorReady, onBlur, m, pageScroll = false }) {
  const editor = useEditor({
    extensions: buildPadExtensions(),
    content: activePad.doc,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `pl-pad-prosemirror ${m.text}`,
        'aria-label': 'Scratchpad',
        spellcheck: 'true',
      },
      transformPastedHTML: (html) => sanitizePastedPadHtml(html, PAD_TEXT_COLORS),
    },
    onUpdate: ({ editor: currentEditor }) => {
      const doc = currentEditor.getJSON();
      onDocumentChange(doc, padDocumentToPlainText(doc));
    },
    onBlur,
  }, [activePad.id]);

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  return (
    <div className={`pl-pad-editor flex-1 rounded-lg border ${m.input} ${m.border} focus-within:border-orange-400 ${pageScroll ? 'min-h-[55vh]' : 'min-h-[18rem]'} overflow-y-auto`}>
      <EditorContent editor={editor} />
    </div>
  );
}
