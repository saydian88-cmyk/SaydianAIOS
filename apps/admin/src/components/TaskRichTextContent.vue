<script setup lang="ts">
import { watch } from "vue";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
const props = withDefaults(defineProps<{ document?: object | null; text?: string | null }>(), { document: null, text: "" });
const plain = (text: string) => ({ type: "doc", content: text.split(/\r?\n/).map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : undefined })) });
const content = () => props.document || plain(props.text || "未填写");
const editor = useEditor({
  editable: false,
  content: content(),
  extensions: [StarterKit.configure({ heading: { levels: [3, 4] }, link: false }), Link.configure({ openOnClick: true }), TaskList, TaskItem.configure({ nested: true })],
});
watch(() => [props.document, props.text], () => editor.value?.commands.setContent(content()), { deep: true });
</script>
<template><EditorContent v-if="editor" :editor="editor" class="task-rich-content" /></template>
<style>
.task-rich-content { line-height: 1.75; overflow-wrap: anywhere; }
.task-rich-content p { margin: 0 0 8px; }
.task-rich-content h3, .task-rich-content h4 { margin: 10px 0 6px; font-size: 16px; }
.task-rich-content ul, .task-rich-content ol { margin: 6px 0; padding-left: 24px; }
.task-rich-content ul[data-type="taskList"] { list-style: none; padding-left: 0; }
.task-rich-content li[data-type="taskItem"] { display: flex; gap: 7px; align-items: flex-start; }
.task-rich-content li[data-type="taskItem"] > div { flex: 1; }
.task-rich-content a { color: #409eff; }
</style>
