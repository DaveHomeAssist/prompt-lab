import { useEffect, useState } from 'react';
import Ic from '../icons';
import { PAD_TEXT_COLORS } from './PadEditor.jsx';

export default function PadToolbar({ editor, m }) {
  const [, setRevision] = useState(0);
  useEffect(() => {
    if (!editor) return undefined;
    const update = () => setRevision((value) => value + 1);
    editor.on('transaction', update);
    editor.on('selectionUpdate', update);
    return () => {
      editor.off('transaction', update);
      editor.off('selectionUpdate', update);
    };
  }, [editor]);

  if (!editor) return <div className={`min-h-10 border-b ${m.border}`} />;

  const buttonClass = (active = false) => `ui-control inline-flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold transition-colors ${
    active ? 'bg-orange-500/90 text-white' : `${m.btn} ${m.textAlt} hover:text-orange-300`
  }`;
  const run = (command) => () => command(editor.chain().focus()).run();
  const blockType = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : 'paragraph';

  return (
    <div className={`flex min-h-10 flex-wrap items-center gap-1.5 border-b px-3 py-1.5 ${m.border}`} role="toolbar" aria-label="Scratchpad formatting">
      <label className="sr-only" htmlFor="pad-block-style">Text style</label>
      <select
        id="pad-block-style"
        value={blockType}
        onChange={(event) => {
          const chain = editor.chain().focus();
          if (event.target.value === 'h1') chain.setHeading({ level: 1 }).run();
          else if (event.target.value === 'h2') chain.setHeading({ level: 2 }).run();
          else chain.setParagraph().run();
        }}
        className={`ui-control h-8 rounded-md border px-2 text-xs ${m.input} ${m.border} ${m.text}`}
      >
        <option value="paragraph">Normal</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
      </select>
      <span className={`mx-1 h-5 w-px ${m.border} border-l`} />
      <button type="button" aria-label="Bold" title="Bold" onClick={run((chain) => chain.toggleBold())} className={buttonClass(editor.isActive('bold'))}>B</button>
      <button type="button" aria-label="Italic" title="Italic" onClick={run((chain) => chain.toggleItalic())} className={`${buttonClass(editor.isActive('italic'))} italic`}>I</button>
      <button type="button" aria-label="Underline" title="Underline" onClick={run((chain) => chain.toggleUnderline())} className={`${buttonClass(editor.isActive('underline'))} underline`}>U</button>
      <span className={`mx-1 h-5 w-px ${m.border} border-l`} />
      <button type="button" aria-label="Bullet list" title="Bullet list" onClick={run((chain) => chain.toggleBulletList())} className={buttonClass(editor.isActive('bulletList'))}><Ic n="List" size={14} /></button>
      <button type="button" aria-label="Numbered list" title="Numbered list" onClick={run((chain) => chain.toggleOrderedList())} className={buttonClass(editor.isActive('orderedList'))}>1.</button>
      <button type="button" aria-label="Toggle list" title="Toggle list" onClick={run((chain) => chain.toggleTaskList())} className={buttonClass(editor.isActive('taskList'))}><Ic n="ListChecks" size={14} /></button>
      <span className={`mx-1 h-5 w-px ${m.border} border-l`} />
      <button type="button" aria-label="Default text color" title="Default text color" onClick={() => editor.chain().focus().unsetColor().run()} className={`${buttonClass(!editor.getAttributes('textStyle').color)} relative`}>
        <span className={`h-3.5 w-3.5 rounded-full border ${m.border} bg-current`} />
      </button>
      {PAD_TEXT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Text color ${color}`}
          title={`Text color ${color}`}
          onClick={() => editor.chain().focus().setColor(color).run()}
          className={`${buttonClass(editor.isActive('textStyle', { color }))}`}
        >
          <span className="h-3.5 w-3.5 rounded-full border border-white/30" style={{ backgroundColor: color }} />
        </button>
      ))}
    </div>
  );
}
