<script setup lang="ts">
import { watch } from "vue";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";

const props = withDefaults(defineProps<{ modelValue?: object | null; placeholder?: string }>(), { modelValue: null, placeholder: "填写任务内容" });
const emit = defineEmits<{ "update:modelValue": [value: object] }>();
const editor = useEditor({
  content: props.modelValue || { type: "doc", content: [{ type: "paragraph" }] },
  extensions: [
    StarterKit.configure({ heading: { levels: [3, 4] }, link: false }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, protocols: ["http", "https", "mailto"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
  ],
  editorProps: { attributes: { class: "task-editor-content", "data-placeholder": props.placeholder } },
  onUpdate: ({ editor }) => emit("update:modelValue", editor.getJSON()),
});
watch(() => props.modelValue, (value) => {
  if (editor.value && value && JSON.stringify(editor.value.getJSON()) !== JSON.stringify(value)) editor.value.commands.setContent(value);
});
function setLink() {
  if (!editor.value) return;
  const href = window.prompt("输入链接（仅支持 http、https 或 mailto）", editor.value.getAttributes("link").href || "");
  if (href === null) return;
  if (!href.trim()) return editor.value.chain().focus().unsetLink().run();
  if (!/^(https?:|mailto:)/i.test(href.trim())) return window.alert("链接格式不支持");
  editor.value.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
}
</script>

<template>
  <div v-if="editor" class="task-editor">
    <div class="task-editor-toolbar">
      <button type="button" :class="{ active: editor.isActive('heading') }" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()">小标题</button>
      <button type="button" :class="{ active: editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()"><strong>加粗</strong></button>
      <button type="button" :class="{ active: editor.isActive('bulletList') }" @click="editor.chain().focus().toggleBulletList().run()">项目符号</button>
      <button type="button" :class="{ active: editor.isActive('orderedList') }" @click="editor.chain().focus().toggleOrderedList().run()">编号</button>
      <button type="button" :class="{ active: editor.isActive('taskList') }" @click="editor.chain().focus().toggleTaskList().run()">待办</button>
      <button type="button" :class="{ active: editor.isActive('link') }" @click="setLink">链接</button>
      <button type="button" :disabled="!editor.can().undo()" @click="editor.chain().focus().undo().run()">撤销</button>
      <button type="button" :disabled="!editor.can().redo()" @click="editor.chain().focus().redo().run()">重做</button>
    </div>
    <EditorContent :editor="editor" />
  </div>
</template>

<style>
.task-editor { border: 1px solid #dcdfe6; border-radius: 8px; overflow: hidden; background: #fff; width: 100%; }
.task-editor-toolbar { display: flex; gap: 4px; flex-wrap: wrap; padding: 7px; border-bottom: 1px solid #ebeef5; background: #fafafa; }
.task-editor-toolbar button { border: 0; border-radius: 5px; padding: 5px 8px; color: #606266; background: transparent; cursor: pointer; }
.task-editor-toolbar button:hover, .task-editor-toolbar button.active { color: #b42318; background: #fef0ed; }
.task-editor-toolbar button:disabled { opacity: .35; cursor: default; }
.task-editor-content { min-height: 110px; padding: 10px 12px; outline: none; line-height: 1.7; }
.task-editor-content p { margin: 0 0 7px; }
.task-editor-content h3, .task-editor-content h4 { margin: 8px 0 5px; font-size: 15px; }
.task-editor-content ul, .task-editor-content ol { margin: 5px 0; padding-left: 22px; }
.task-editor-content ul[data-type="taskList"] { list-style: none; padding-left: 0; }
.task-editor-content li[data-type="taskItem"] { display: flex; gap: 7px; align-items: flex-start; }
.task-editor-content li[data-type="taskItem"] > div { flex: 1; }
.task-editor-content a { color: #409eff; text-decoration: underline; }
</style>
