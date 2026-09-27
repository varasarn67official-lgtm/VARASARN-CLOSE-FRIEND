<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { AdminService, type Category, type ManagedCourse } from '../../services/admin'

const props = defineProps<{ service: AdminService; categories: Category[]; courses: ManagedCourse[]; loading: boolean; loadError: string; countsLoading: boolean; countsError: string }>()
const emit = defineEmits<{ changed: []; retry: []; toast: [string] }>()

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

async function beginEdit(category: Category) {
  editingId.value = category.id; editingValue.value = category.name; error.value = ''
  await nextTick()
  document.getElementById('admin-category-rename')?.focus()
}
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
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <form class="admin-category-toolbar" @submit.prevent="addCategory">
      <div><label class="section-label-sm" for="admin-new-category">ชื่อหมวดหมู่ใหม่</label>
        <input id="admin-new-category" v-model="newName" class="form-control" />
      </div>
      <button class="btn btn-purple" type="submit">เพิ่ม</button>
    </form>
    <div :aria-busy="loading && !categories.length">
    <div v-if="loading && !categories.length" aria-label="กำลังโหลดหมวดหมู่"><div v-for="n in 6" :key="n" class="admin-skeleton-row" aria-hidden="true"></div></div>
    <template v-else>
    <div v-if="loadError || countsError" class="admin-load-error" role="alert">{{ loadError || countsError }} <button class="btn btn-outline-purple" @click="emit('retry')">ลองใหม่</button></div>
    <table v-if="categories.length" class="admin-table admin-category-table" aria-label="หมวดหมู่">
      <thead><tr><th>ชื่อหมวดหมู่</th><th class="admin-count-cell">รายวิชา</th><th class="admin-category-actions"><span class="visually-hidden">การจัดการ</span></th></tr></thead>
      <tbody><tr v-for="category in categories" :key="category.id">
        <td>
          <input v-if="editingId === category.id" id="admin-category-rename" v-model="editingValue" class="form-control" :aria-label="`ชื่อหมวดหมู่ ${category.name}`" @keydown.enter.prevent="saveEdit(category)" @keydown.esc.prevent="cancelEdit" />
          <template v-else>{{ category.name }}</template>
        </td>
        <td class="admin-count-cell"><span v-if="countsLoading || countsError" aria-label="ยังไม่ทราบจำนวนรายวิชา">—</span><span v-else-if="!courseCount.get(category.id)" class="admin-state-badge admin-state-neutral">ไม่มีรายวิชา</span><template v-else>{{ courseCount.get(category.id) }}</template></td>
        <td class="admin-category-actions">
          <div v-if="editingId === category.id" class="admin-row-actions">
            <button class="btn btn-sm btn-outline-secondary" @click="cancelEdit">ยกเลิก</button>
            <button class="btn btn-sm btn-purple" @click="saveEdit(category)">บันทึก</button>
          </div>
          <button v-else class="btn btn-sm btn-outline-purple" :aria-label="`แก้ไข ${category.name}`" @click="beginEdit(category)">แก้ไข</button>
        </td>
      </tr></tbody>
    </table>
    <p v-else-if="!loadError" class="text-muted">ยังไม่มีหมวดหมู่</p>
    </template>
    </div>
  </div>
</template>
