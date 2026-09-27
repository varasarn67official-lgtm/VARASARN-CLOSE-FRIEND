<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AdminService, type RoleAssignment, type VerifiedAccount } from '../../services/admin'

const props = defineProps<{ service: AdminService }>()
const emit = defineEmits<{ toast: [string] }>()

const members = ref<RoleAssignment[]>([])
const verifiedAccounts = ref<VerifiedAccount[]>([])
const loading = ref(true)
const error = ref('')
const search = ref('')

function roleLabel(role: 'owner' | 'administrator') { return role === 'owner' ? 'เจ้าของระบบ' : 'ผู้ดูแล' }

async function load() {
  loading.value = true
  try { [members.value, verifiedAccounts.value] = await Promise.all([props.service.listRoleAssignments(), props.service.listVerifiedAccounts()]) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดข้อมูลผู้ดูแลระบบได้' }
  finally { loading.value = false }
}

const availableAccounts = computed(() => {
  const query = search.value.trim().toLowerCase()
  return verifiedAccounts.value
    .filter((account) => !members.value.some((member) => member.id === account.id))
    .filter((account) => !query || `${account.name} ${account.email}`.toLowerCase().includes(query))
})

async function grant(userId: string) {
  try { await props.service.grantAdministrator(userId); await load(); emit('toast', 'กำหนดสิทธิ์ผู้ดูแลสำเร็จ') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถกำหนดสิทธิ์ผู้ดูแลได้' }
}
async function revoke(userId: string) {
  try { await props.service.revokeAdministrator(userId); await load(); emit('toast', 'ถอนสิทธิ์ผู้ดูแลสำเร็จ') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถถอนสิทธิ์ผู้ดูแลได้' }
}

onMounted(load)
</script>

<template>
  <div class="admin-section">
    <h2 tabindex="-1" class="admin-section-heading">ผู้ดูแลระบบ</h2>
    <p class="admin-section-desc">กำหนดสิทธิ์ให้บัญชี Google ที่ยืนยันแล้วเท่านั้น</p>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-muted">กำลังโหลดข้อมูล...</p>
    <template v-else>
      <h3 class="h6">ผู้ดูแลปัจจุบัน</h3>
      <div class="review-box">
        <div v-for="member in members" :key="member.id" class="d-flex justify-content-between align-items-center border-bottom py-2 flex-wrap gap-2">
          <span><strong>{{ member.name || member.email }}</strong> <small class="text-muted">{{ roleLabel(member.role) }}</small></span>
          <button v-if="member.role === 'administrator'" class="btn btn-sm btn-outline-danger" @click="revoke(member.id)">ถอนสิทธิ์</button>
        </div>
        <p v-if="!members.length" class="text-muted mb-0">ยังไม่มีผู้ดูแลเพิ่มเติม</p>
      </div>
      <h3 class="h6 mt-3">บัญชีที่ยืนยันแล้ว</h3>
      <div class="mb-2">
        <label class="section-label-sm" for="admin-role-search">ค้นหาชื่อหรืออีเมล</label>
        <input id="admin-role-search" v-model="search" class="form-control" placeholder="ค้นหาชื่อหรืออีเมล" />
      </div>
      <div class="review-box">
        <div v-for="account in availableAccounts" :key="account.id" class="d-flex justify-content-between align-items-center border-bottom py-2 flex-wrap gap-2">
          <span>{{ account.name || account.email }}</span>
          <button class="btn btn-sm btn-purple" @click="grant(account.id)">แต่งตั้งผู้ดูแล</button>
        </div>
        <p v-if="!availableAccounts.length" class="text-muted mb-0">ไม่มีบัญชีที่รอการแต่งตั้ง</p>
      </div>
    </template>
  </div>
</template>
