import { ArrowUturnLeft, ListBullet, Text as TextIcon } from "@medusajs/icons"
import { clx } from "@medusajs/ui"
import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import Underline from "@tiptap/extension-underline"
import { Editor, EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { forwardRef, useEffect, useImperativeHandle } from "react"

/**
 * Rich text editor wrapping TipTap, output as HTML.
 *
 * Designed as a drop-in replacement for `<Textarea>` inside a react-hook-form
 * `<Form.Control>`: the parent passes react-hook-form's `value`, `onChange`,
 * `onBlur` and we keep the editor in sync.
 *
 * The editor never re-mounts on `value` change after mount — that would lose
 * focus and cursor position on every keystroke. Instead, we only sync when the
 * incoming value differs from what TipTap currently holds (e.g. form reset).
 */
export type RichTextEditorProps = {
  value?: string
  onChange?: (html: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
}

export const RichTextEditor = forwardRef<Editor | null, RichTextEditorProps>(
  function RichTextEditor(
    { value, onChange, onBlur, placeholder, disabled, className, id },
    ref
  ) {
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // StarterKit ships heading 1-6; we only expose 2-3 in the toolbar
          // but allow all so pasted content keeps its semantics.
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        Underline,
        Link.configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        }),
        Placeholder.configure({
          placeholder: placeholder ?? "",
        }),
      ],
      content: value ?? "",
      editable: !disabled,
      onUpdate: ({ editor }) => {
        const html = editor.getHTML()
        // TipTap returns "<p></p>" for an empty editor; surface "" so
        // react-hook-form treats it as empty for "required" validations.
        onChange?.(html === "<p></p>" ? "" : html)
      },
      onBlur: () => onBlur?.(),
      editorProps: {
        attributes: {
          id: id ?? "",
          class: clx(
            "prose prose-sm max-w-none focus:outline-none",
            "min-h-[160px] px-3 py-2",
            "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_h1]:my-3 [&_h2]:my-3 [&_h3]:my-2",
            "[&_ul]:list-disc [&_ul]:pl-6",
            "[&_ol]:list-decimal [&_ol]:pl-6",
            "[&_a]:text-ui-fg-interactive [&_a]:underline",
            "[&_p.is-editor-empty:first-child::before]:text-ui-fg-muted",
            "[&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
            "[&_p.is-editor-empty:first-child::before]:float-left",
            "[&_p.is-editor-empty:first-child::before]:pointer-events-none",
            "[&_p.is-editor-empty:first-child::before]:h-0"
          ),
        },
      },
    })

    useImperativeHandle(ref, () => editor as Editor, [editor])

    // Sync external value changes (e.g. form reset, async load) without
    // remounting the editor — would otherwise blow away focus on every render.
    useEffect(() => {
      if (!editor) return
      const next = value ?? ""
      const current = editor.getHTML()
      const currentNormalised = current === "<p></p>" ? "" : current
      if (next !== currentNormalised) {
        editor.commands.setContent(next, false)
      }
    }, [value, editor])

    useEffect(() => {
      editor?.setEditable(!disabled)
    }, [disabled, editor])

    if (!editor) {
      return null
    }

    return (
      <div
        className={clx(
          "border-ui-border-base bg-ui-bg-field rounded-md border",
          "focus-within:shadow-borders-interactive-with-focus",
          "transition-all",
          disabled && "bg-ui-bg-disabled cursor-not-allowed opacity-50",
          className
        )}
      >
        <Toolbar editor={editor} disabled={disabled} />
        <EditorContent editor={editor} />
      </div>
    )
  }
)

type ToolbarProps = { editor: Editor; disabled?: boolean }

function Toolbar({ editor, disabled }: ToolbarProps) {
  const buttonClass = (active: boolean) =>
    clx(
      "txt-compact-small inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5",
      "text-ui-fg-subtle hover:bg-ui-bg-base-hover hover:text-ui-fg-base",
      "disabled:cursor-not-allowed disabled:opacity-40",
      "transition-colors",
      active && "bg-ui-bg-base-hover text-ui-fg-base"
    )

  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href
    const url = window.prompt("URL", previousUrl ?? "")
    if (url === null) return
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      return
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run()
  }

  return (
    <div className="border-ui-border-base flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5">
      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("bold"))}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (⌘B)"
        aria-label="Bold"
      >
        <span className="font-bold">B</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("italic"))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (⌘I)"
        aria-label="Italic"
      >
        <span className="italic">I</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("underline"))}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline (⌘U)"
        aria-label="Underline"
      >
        <span className="underline">U</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("strike"))}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
        aria-label="Strikethrough"
      >
        <span className="line-through">S</span>
      </button>

      <Divider />

      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("heading", { level: 2 }))}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
        title="Heading 2"
        aria-label="Heading 2"
      >
        H2
      </button>
      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("heading", { level: 3 }))}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 3 }).run()
        }
        title="Heading 3"
        aria-label="Heading 3"
      >
        H3
      </button>
      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("paragraph"))}
        onClick={() => editor.chain().focus().setParagraph().run()}
        title="Paragraph"
        aria-label="Paragraph"
      >
        <TextIcon className="h-3.5 w-3.5" />
      </button>

      <Divider />

      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("bulletList"))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bulleted list"
        aria-label="Bulleted list"
      >
        <ListBullet className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("orderedList"))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
        aria-label="Numbered list"
      >
        1.
      </button>
      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("blockquote"))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Blockquote"
        aria-label="Blockquote"
      >
        &ldquo;
      </button>
      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("code"))}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Inline code"
        aria-label="Inline code"
      >
        {"</>"}
      </button>

      <Divider />

      <button
        type="button"
        disabled={disabled}
        className={buttonClass(editor.isActive("link"))}
        onClick={setLink}
        title="Link"
        aria-label="Link"
      >
        🔗
      </button>

      <Divider />

      <button
        type="button"
        disabled={disabled || !editor.can().undo()}
        className={buttonClass(false)}
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo (⌘Z)"
        aria-label="Undo"
      >
        <ArrowUturnLeft className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled || !editor.can().redo()}
        className={buttonClass(false)}
        onClick={() => editor.chain().focus().redo().run()}
        title="Redo (⇧⌘Z)"
        aria-label="Redo"
      >
        <ArrowUturnLeft className="h-3.5 w-3.5 scale-x-[-1]" />
      </button>
    </div>
  )
}

function Divider() {
  return <span className="bg-ui-border-base mx-0.5 h-4 w-px" />
}
