'use client';

import { useCallback, useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, ImagePlus, Italic, List, ListOrdered } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng';
import {
  serviceFileDataDownloadUrl,
  useServiceFileChunkedUpload,
} from '@/app/(pages)/map/_mapComponents/standard/useServiceFileData';

const LAYER = 'system_feedback';
const EDITOR_SUB = 'editor';

type Props = {
  sfKey: number | null;
  contentHtml: string;
  onChange: (html: string) => void;
  onEditorImageFile?: (file: File, downloadUrl: string) => void;
  readOnly?: boolean;
  className?: string;
};

export function SystemFeedbackEditor({
  sfKey,
  contentHtml,
  onChange,
  onEditorImageFile,
  readOnly = false,
  className,
}: Props) {
  const chunkUpload = useServiceFileChunkedUpload();

  const uploadImage = useCallback(
    async (file: File): Promise<string | null> => {
      if (sfKey == null || sfKey <= 0) {
        window.alert('신고 초안이 준비된 뒤 이미지를 넣을 수 있습니다.');
        return null;
      }
      const result = await chunkUpload.upload({
        file,
        serEng: SER_FILE_ENG.systemFeedback,
        layerSegment: LAYER,
        keyValue: sfKey,
        subfolder: EDITOR_SUB,
      });
      if (!result || result.error) {
        window.alert(result?.error ?? '이미지 업로드 실패');
        return null;
      }
      const url = serviceFileDataDownloadUrl(
        SER_FILE_ENG.systemFeedback,
        LAYER,
        sfKey,
        file.name,
        { subfolder: EDITOR_SUB }
      );
      onEditorImageFile?.(file, url);
      return url;
    },
    [sfKey, chunkUpload, onEditorImageFile]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
      }),
      Placeholder.configure({
        placeholder: '불편·오류 내용을 입력하세요. 이미지도 넣을 수 있습니다.',
      }),
    ],
    content: contentHtml || '',
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          'h-full min-h-0 px-2.5 py-2 text-[12px] leading-relaxed text-foreground focus:outline-none [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li]:leading-relaxed [&_img]:max-w-full',
      },
      handlePaste: (_view, event) => {
        if (readOnly || sfKey == null) return false;
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (!item.type.startsWith('image/')) continue;
          const file = item.getAsFile();
          if (!file) continue;
          event.preventDefault();
          void uploadImage(file).then((url) => {
            if (url && editor) {
              editor.chain().focus().setImage({ src: url }).run();
            }
          });
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        if (readOnly || sfKey == null) return false;
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        const file = Array.from(files).find((f) => f.type.startsWith('image/'));
        if (!file) return false;
        event.preventDefault();
        void uploadImage(file).then((url) => {
          if (url && editor) {
            editor.chain().focus().setImage({ src: url }).run();
          }
        });
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if ((contentHtml || '') !== current && readOnly) {
      editor.commands.setContent(contentHtml || '', { emitUpdate: false });
    }
  }, [editor, contentHtml, readOnly]);

  const pickImage = () => {
    if (readOnly || sfKey == null) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void uploadImage(file).then((url) => {
        if (url && editor) {
          editor.chain().focus().setImage({ src: url }).run();
        }
      });
    };
    input.click();
  };

  if (!editor) {
    return (
      <div className={cn('rounded border border-border bg-muted/20 px-3 py-6 text-xs text-muted-foreground', className)}>
        에디터 준비 중…
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded border border-border bg-white dark:bg-background',
        className
      )}
    >
      {!readOnly ? (
        <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border bg-slate-100 px-1.5 py-1 dark:bg-white/10">
          <ToolbarBtn
            title="굵게"
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            title="기울임"
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            title="글머리 기호"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            title="번호 목록"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            title="이미지 삽입"
            onClick={pickImage}
            disabled={chunkUpload.state.status === 'uploading' || sfKey == null}
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </ToolbarBtn>
          {chunkUpload.state.status === 'uploading' ? (
            <span className="ml-1 text-xs text-muted-foreground">
              이미지 {chunkUpload.state.progress}%
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin [&_.tiptap]:min-h-full">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}

function ToolbarBtn({
  title,
  active,
  onClick,
  disabled,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50',
        active && 'bg-primary/15 text-primary'
      )}
    >
      {children}
    </button>
  );
}
