<script setup lang="ts">
import { computed, ref } from 'vue'
import { AdminService, type Category, type ManagedCourse } from '../../services/admin'

const props = defineProps<{ service: AdminService; categories: Category[]; courses: ManagedCourse[] }>()
const emit = defineEmits<{ changed: []; toast: [string] }>()

const error = ref('')
const newName = ref('')
const editingId = ref<string | null>(null)
const editingValue = ref('')

const courseCount = computed(() => {
  const counts = new Map<string, number>()
  for (const course of props.courses) counts.set(course.category_id, (counts.get(course.category_id) ?? 0) + 1)
  return counts
})

async function addCategory() {
  if (!newName.value.trim()) return
  try {
    await props.service.createCategory(newName.value)
    newName.value = ''
    emit('changed')
    emit('toast', 'เพิ่มหมวดหมู่สำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถเพิ่มหมวดหมู่ได้' }
}

function beginEdit(category: Category) { editingId.value = category.id; editingValue.value = category.name; error.value = '' }
function cancelEdit() { editingId.value = null; editingValue.value = '' }

async function saveEdit(category: Category) {
  if (!editingValue.value.trim()) return
  try {
    await props.service.updateCategory(category.id, editingValue.value)
    editingId.value = null
    emit('changed')
    emit('toast', 'แก้ไขหมวดหมู่สำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถแก้ไขหมวดหมู่ได้' }
}
</script>

<template>
  <div class="admin-section">
    <h2 tabindex="-1" class="admin-section-heading">หมวดหมู่</h2>
    <p class="admin-section-desc">เพิ่มและเปลี่ยนชื่อหมวดหมู่รายวิชา</p>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <div class="mb-3">
      <label class="section-label-sm" for="admin-new-category">ชื่อหมวดหมู่ใหม่</label>
      <div class="input-group">
        <input id="admin-new-category" v-model="newName" class="form-control" />
        <button class="btn btn-purple" @click="addCategory">เพิ่ม</button>
      </div>
    </div>
    <ul class="list-group admin-flex-list">
      <li v-for="category in categories" :key="category.id" class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
        <template v-if="editingId === category.id">
          <input v-model="editingValue" class="form-control" style="max-width: 260px" :aria-label="`ชื่อหมวดหมู่ ${category.name}`" />
          <span class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-secondary" @click="cancelEdit">ยกเลิก</button>
            <button class="btn btn-sm btn-purple" @click="saveEdit(category)">บันทึก</button>
          </span>
        </template>
        <template v-else>
          <span>{{ category.name }} <small class="text-muted">{{ courseCount.get(category.id) ?? 0 }} รายวิชา</small></span>
          <button class="btn btn-sm btn-outline-purple" @click="beginEdit(category)">แก้ไข</button>
        </template>
      </li>
    </ul>
    <p v-if="!categories.length" class="text-muted">ยังไม่มีหมวดหมู่</p>
  </div>
</template>
