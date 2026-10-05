<script setup lang="ts">
import { searchKey } from './search'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { neon, signInWithGoogle } from './neon'
import { fetchAllRows, withRange } from './services/pagination'
import { AdminService, type Category } from './services/admin'
import { ReviewService, type VisibleReview } from './services/reviews'
import { TimetableService } from './services/timetable-client'
import { isValidMeeting, overlaps, type Meeting } from './services/timetable'
import { ProposalService, type OfferingProposal } from './services/proposals'
import { migrateLegacyTimetable, readLegacyTimetable, type LegacyClass } from './services/legacy-timetable-import'
import AdminDashboard from './components/admin/AdminDashboard.vue'
import StarRating from './components/StarRating.vue'
import LoginBrowserHelp from './components/LoginBrowserHelp.vue'
import { embeddedBrowser, recordAuthFailure } from './services/auth-recovery'

type Course = { id: string; code: string; name_th: string; category_name: string; review_count?: number; average_rating?: number | null }
type Offering = { id: string; section: string; academic_year: number; semester: string; instructor_name: string | null }
type TimetableEntry = { offering_id: string | null; review_id: string | null; legacy_entry_id?: string | null; source: 'official' | 'reported' | 'legacy'; course_code: string; course_name: string; section: string; day_of_week: number; starts_at: string; ends_at: string; instructor_name: string | null }
const courses = ref<Course[]>([]); const offerings = ref<Offering[]>([]); const reviews = ref<VisibleReview[]>([])
const offeringMeetings = ref<Record<string, Meeting[]>>({})
const selected = ref<Course | null>(null); const rating = ref(5); const text = ref(''); const error = ref(''); const loading = ref(true); const signedIn = ref(false); const publishing = ref(false)
const startupDataErrors = ref<string[]>([]); const startupDataLoading = ref(false)
let sessionGeneration = 0
let catalogInFlight = false
const catalogErrorMessage = 'กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง หากยังพบปัญหา กรุณาติดต่อผู้ดูแล'
const loginErrorMessage = 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองเข้าสู่ระบบด้วย Google อีกครั้ง หากยังพบปัญหา กรุณาติดต่อผู้ดูแล'
const signingIn = ref(false)
const restoringSession = ref(Boolean(neon))
const loginFailureStage = ref<'session' | 'sign-in' | null>(null)
const googleSignInButton = ref<HTMLButtonElement | null>(null)
const inAppBrowser = embeddedBrowser(navigator.userAgent)
const loginFailureTitle = computed(() => loginFailureStage.value === 'session' ? 'ยังเข้าใช้งานไม่ได้' : 'เข้าสู่ระบบไม่สำเร็จ')
const loginFailureDescription = computed(() => inAppBrowser
  ? 'เปิดเว็บไซต์ใน Safari หรือ Chrome เพื่อเข้าสู่ระบบด้วย Google'
  : loginFailureStage.value === 'session'
    ? 'ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ ลองเข้าสู่ระบบด้วย Google อีกครั้ง'
    : 'ลองเข้าสู่ระบบด้วย Google อีกครั้ง')
const browserHelp = ref<InstanceType<typeof LoginBrowserHelp> | null>(null)
const reviewFormOpen = ref(false)
watch(selected, (value) => { document.body.style.overflow = value ? 'hidden' : '' })
type ConfirmVariant = 'warning' | 'success'
const confirmDialog = ref<{ message: string; confirmLabel: string; cancelLabel: string; variant: ConfirmVariant; resolve: (value: boolean) => void } | null>(null)
function showConfirm(message: string, confirmLabel: string, cancelLabel: string, variant: ConfirmVariant): Promise<boolean> {
  return new Promise((resolve) => { confirmDialog.value = { message, confirmLabel, cancelLabel, variant, resolve } })
}
function resolveConfirm(value: boolean) { confirmDialog.value?.resolve(value); confirmDialog.value = null }
const toastMessage = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(message: string) {
  toastMessage.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMessage.value = null }, 3000)
}
const reviewSemester = ref(''); const reviewYear = ref(0); const reviewTeacher = ref(''); const reviewSection = ref(''); const reviewDay = ref('จันทร์'); const reviewStart = ref(''); const reviewEnd = ref('')
const service = computed(() => neon ? new ReviewService(neon as any) : null)
const adminService = computed(() => neon ? new AdminService(neon as any) : null)
const timetableService = computed(() => neon ? new TimetableService(neon as any) : null)
const proposalService = computed(() => neon ? new ProposalService(neon as any) : null)
const accessRole = ref<'owner' | 'administrator' | null>(null); const dashboard = ref(false)
const accountMenuOpen = ref(false); const contactOpen = ref(false); const displayName = ref('บัญชีของฉัน')
const signedInEmail = ref('')
let activeMigrationUserId: string | null = null
let migrationPromise: Promise<void> | null = null
let retryEntries: LegacyClass[] = []
const timetable = ref(false); const timetableEntries = ref<TimetableEntry[]>([])
const timetableLoading = ref(false)
const timetableActive = computed(() => signedIn.value && timetable.value && !dashboard.value)
const myReviewsScreen = ref(false); const myReviews = ref<import('./services/reviews').MyReview[]>([])
const reviewHistoryId = ref<string | null>(null); const reviewHistory = ref<import('./services/reviews').ReviewRevision[]>([])
const editingReviewId = ref<string | null>(null); const editReviewRating = ref(5); const editReviewText = ref('')
const categories = ref<Category[]>([]); const courseCode = ref(''); const courseName = ref(''); const courseCategoryId = ref('')
const courseModalOpen = ref(false)
const proposalYear = ref(new Date().getFullYear() + 543); const proposalSemester = ref('1'); const proposalSection = ref(''); const proposalInstructor = ref(''); const myProposals = ref<OfferingProposal[]>([])
const searchTerm = ref(''); const categoryFilter = ref('')
const categoriesExpanded = ref(false)
const reviewRatingFilter = ref(0); const reviewSemesterFilter = ref(''); const reviewYearFilter = ref(0)
type CatalogSort = 'code' | 'reviews' | 'rating'
const reviewedOnly = ref(false); const catalogSort = ref<CatalogSort>('code'); const catalogError = ref('')
function isReviewed(course: Course) { return (course.review_count ?? 0) > 0 }
function matchesSearch(course: Course) {
  const search = searchKey(searchTerm.value)
  return !search || searchKey(course.code).includes(search) || searchKey(course.name_th).includes(search)
}
function matchesSearchAndReviewed(course: Course) { return matchesSearch(course) && (!reviewedOnly.value || isReviewed(course)) }
const filteredCourses = computed(() => {
  const matches = courses.value.filter((course) => matchesSearchAndReviewed(course) && (!categoryFilter.value || course.category_name === categoryFilter.value))
  if (catalogSort.value === 'code') return matches
  const byCode = (a: Course, b: Course) => a.code.localeCompare(b.code)
  const byReviews = (a: Course, b: Course) => (b.review_count ?? 0) - (a.review_count ?? 0)
  return [...matches].sort(catalogSort.value === 'reviews'
    ? (a, b) => byReviews(a, b) || byCode(a, b)
    : (a, b) => (b.average_rating ?? -1) - (a.average_rating ?? -1) || byReviews(a, b) || byCode(a, b))
})
// Each count says how many results picking that control would give: category pills follow the
// search and reviewed filters, the reviewed toggle follows the search and category filters.
const categoryCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const course of courses.value) if (matchesSearchAndReviewed(course)) counts[course.category_name] = (counts[course.category_name] ?? 0) + 1
  return counts
})
const searchAndReviewedCount = computed(() => Object.values(categoryCounts.value).reduce((sum, count) => sum + count, 0))
const reviewedCount = computed(() => courses.value.filter((course) => isReviewed(course) && matchesSearch(course) && (!categoryFilter.value || course.category_name === categoryFilter.value)).length)
const catalogCountsAvailable = computed(() => courses.value.length > 0 || (!loading.value && !catalogError.value))
const catalogFiltered = computed(() => Boolean(searchTerm.value.trim() || categoryFilter.value || reviewedOnly.value))
async function loadCatalog() {
  if (!neon) { loading.value = false; error.value = 'ตั้งค่า Neon endpoint ใน .env.local ก่อนใช้งาน'; return }
  if (catalogInFlight) return
  const generation = sessionGeneration
  catalogInFlight = true
  loading.value = true; catalogError.value = ''
  try {
    const { data, error: apiError } = await fetchAllRows<Course>((from, to) => withRange((neon as any).rpc('list_approved_catalog', undefined, { count: 'exact' }), from, to))
    if (generation !== sessionGeneration) return
    // Preserve partial rows on a later-page error, and retain an already-loaded catalog.
    if (apiError) { catalogError.value = catalogErrorMessage; if (!courses.value.length) courses.value = data }
    else courses.value = data
  } catch {
    if (generation === sessionGeneration) catalogError.value = catalogErrorMessage
  } finally {
    if (generation === sessionGeneration) { loading.value = false; catalogInFlight = false }
  }
}
const catalogActive = computed(() => signedIn.value && !dashboard.value && !timetable.value && !myReviewsScreen.value)
const toolbarStuck = ref(false); const showBackToTop = ref(false); const searchFocused = ref(false)
// The sentinel sits just above the sticky toolbar; once it scrolls above the viewport the
// toolbar is stuck. Read on scroll (one rect per event) rather than via IntersectionObserver,
// whose callbacks can lag behind a programmatic scroll the filter watcher needs to act on.
let toolbarSentinel: HTMLElement | null = null
function setToolbarSentinel(element: unknown) { toolbarSentinel = element instanceof HTMLElement ? element : null; updateScrollState() }
function updateScrollState() {
  toolbarStuck.value = !!toolbarSentinel && toolbarSentinel.getBoundingClientRect().top < 0
  showBackToTop.value = window.scrollY > window.innerHeight * 2
}
// Changing a filter while deep in a 200+ card list would otherwise leave the reader somewhere
// in the middle of (or past the end of) the new, shorter result list.
watch([searchTerm, categoryFilter, reviewedOnly, catalogSort], () => {
  updateScrollState()
  // 'instant', not the default: Bootstrap's reboot sets `scroll-behavior: smooth`, and a smooth
  // scroll still running when the list shrinks gets clamped at the new, shorter page's end.
  if (toolbarStuck.value && toolbarSentinel) window.scrollTo({ top: toolbarSentinel.getBoundingClientRect().top + window.scrollY + 1, behavior: 'instant' })
})
async function selectCategory(name: string, event: Event) {
  const button = event.currentTarget as HTMLElement | null
  updateScrollState()
  const wasStuck = toolbarStuck.value
  categoryFilter.value = categoryFilter.value === name ? '' : name
  categoriesExpanded.value = false
  await nextTick()
  button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  // Revealing the selected pill after collapse can scroll the page as well as the
  // pill row. Restore the sticky position after that browser layout adjustment.
  if (wasStuck && toolbarSentinel) window.scrollTo({ top: toolbarSentinel.getBoundingClientRect().top + window.scrollY + 1, behavior: 'instant' })
}
function scrollToTop() {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
}
window.addEventListener('scroll', updateScrollState, { passive: true })
onBeforeUnmount(() => { sessionGeneration += 1; window.removeEventListener('scroll', updateScrollState) })
async function loadOfferings(courseId: string) {
  offerings.value = []; offeringMeetings.value = {}
  const { data, error: apiError } = await (neon as any).rpc('list_approved_offerings', { p_course_id: courseId })
  if (apiError) error.value = apiError.message
  offerings.value = data ?? []
  await Promise.all(offerings.value.map(async (offering) => {
    try {
      const result = await (neon as any).rpc('list_approved_offering_meetings', { p_offering_id: offering.id })
      if (result.error) throw new Error(result.error.message)
      offeringMeetings.value[offering.id] = ((result.data ?? []) as Array<{ day_of_week: number; starts_at: string; ends_at: string }>).map((row) => ({ day: row.day_of_week, start: timeValue(row.starts_at), end: timeValue(row.ends_at) })).filter(isValidMeeting)
    } catch { offeringMeetings.value[offering.id] = [] }
  }))
}
async function openCourse(course: Course) {
  selected.value = course; reviewFormOpen.value = false; error.value = ''; reviews.value = []
  await loadOfferings(course.id)
  reviewSemester.value = offerings.value[0]?.semester ?? ''; reviewYear.value = offerings.value[0]?.academic_year ?? 0; reviewTeacher.value = offerings.value[0]?.instructor_name ?? ''; reviewSection.value = offerings.value[0]?.section ?? ''; reviewDay.value = 'จันทร์'; reviewStart.value = ''; reviewEnd.value = ''
  await Promise.all([loadReviews(course.id), loadMyProposals(), loadTimetable().catch((cause) => { timetableEntries.value = []; error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดตารางเรียนได้' })])
}
async function loadReviews(courseId = selected.value?.id) {
  if (!courseId || !service.value) return
  try {
    reviews.value = await service.value.listVisible(courseId, { rating: reviewRatingFilter.value || undefined, semester: reviewSemesterFilter.value || undefined, academicYear: reviewYearFilter.value || undefined })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดรีวิวได้' }
}
async function loadTimetable() {
  if (!timetableService.value) return
  timetableLoading.value = true
  try { timetableEntries.value = await timetableService.value.list() as TimetableEntry[] }
  finally { timetableLoading.value = false }
}
async function runLegacyMigration(userId: string, entries: LegacyClass[]) {
  if (!neon || activeMigrationUserId !== userId || migrationPromise) return migrationPromise
  migrationPromise = (async () => {
    let pending = entries.filter((entry) => !entry.invalidReason)
    const delays = [0, 1000, 5000, 30000]
    for (const delay of delays) {
      if (delay && navigator.onLine) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(finish, delay)
          function finish() {
            clearTimeout(timer)
            window.removeEventListener('online', finish)
            resolve()
          }
          window.addEventListener('online', finish, { once: true })
        })
      }
      if (activeMigrationUserId !== userId || !pending.length || !navigator.onLine) break
      const outcomes = await migrateLegacyTimetable(neon as any, pending)
      pending = outcomes.filter((result) => result.outcome === 'retryable').map((result) => result.entry)
      retryEntries = pending
      if (outcomes.some((result) => result.outcome === 'added-official' || result.outcome === 'added-legacy' || result.outcome === 'already-present') && timetable.value) {
        await loadTimetable().catch(() => undefined)
      }
    }
  })().catch(() => undefined).finally(() => { migrationPromise = null })
  return migrationPromise
}
function retryLegacyMigrationWhenOnline() {
  if (activeMigrationUserId && retryEntries.length) void runLegacyMigration(activeMigrationUserId, retryEntries)
}
window.addEventListener('online', retryLegacyMigrationWhenOnline)
onBeforeUnmount(() => window.removeEventListener('online', retryLegacyMigrationWhenOnline))
function bangkokWeekday() {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short' }).format(new Date())
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(day) + 1
}
const dayNames = ['','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์']
const shortDayNames = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.']
const selectedTimetableDay = ref(bangkokWeekday())
function showTimetable() {
  selectedTimetableDay.value = bangkokWeekday()
  timetable.value = true; dashboard.value = false; myReviewsScreen.value = false
  selected.value = null; accountMenuOpen.value = false; error.value = ''
}
function showCatalog() {
  timetable.value = false; dashboard.value = false; myReviewsScreen.value = false
  selected.value = null; accountMenuOpen.value = false; error.value = ''
}
async function openTimetable() { showTimetable(); try { await loadTimetable() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดตารางเรียนได้' } }
const selectedDayEntries = computed(() => timetableEntries.value
  .filter((entry) => entry.day_of_week === selectedTimetableDay.value)
  .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.ends_at.localeCompare(b.ends_at) || a.course_code.localeCompare(b.course_code)))
function timetableMinutes(time: string) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) }
function timetableDuration(entry: TimetableEntry) { return timetableMinutes(entry.ends_at) - timetableMinutes(entry.starts_at) }
const timetableListFallback = computed(() => {
  let previousEnd = -1
  for (const entry of selectedDayEntries.value) {
    if (timetableDuration(entry) < 30 || timetableMinutes(entry.starts_at) < previousEnd) return true
    previousEnd = Math.max(previousEnd, timetableMinutes(entry.ends_at))
  }
  return false
})
const timelineStart = computed(() => Math.min(480, ...selectedDayEntries.value.map((entry) => Math.floor(timetableMinutes(entry.starts_at) / 60) * 60)))
const timelineEnd = computed(() => Math.max(1200, ...selectedDayEntries.value.map((entry) => Math.ceil(timetableMinutes(entry.ends_at) / 60) * 60)))
const timelineHours = computed(() => Array.from({ length: (timelineEnd.value - timelineStart.value) / 60 + 1 }, (_, index) => timelineStart.value / 60 + index))
function timetableMeetingKey(entry: TimetableEntry) { return `${entry.source}-${entry.offering_id ?? entry.review_id ?? entry.legacy_entry_id}-${entry.day_of_week}-${entry.starts_at}-${entry.ends_at}` }
function timetableDayStyle(entry: TimetableEntry) {
  return {
    top: `calc(var(--timetable-hour-height) * ${(timetableMinutes(entry.starts_at) - timelineStart.value) / 60} + 4px)`,
    height: `calc(var(--timetable-hour-height) * ${timetableDuration(entry) / 60} - 8px)`,
  }
}
function timetableEntryLabel(entry: TimetableEntry) {
  return `${entry.course_code} กลุ่ม ${entry.section} ${entry.course_name} เวลา ${timeValue(entry.starts_at)}–${timeValue(entry.ends_at)}${entry.instructor_name ? ` ${entry.instructor_name}` : ''} ลบออกจากตารางเรียน`
}
function returnToCatalog() { showCatalog() }
const timetableAccountButton = ref<HTMLButtonElement | null>(null)
function closeTimetableAccountMenu() { accountMenuOpen.value = false; timetableAccountButton.value?.focus() }
function timeValue(time: string) { return time.slice(0, 5) }
function reviewOffering(review: VisibleReview): Offering | null {
  if (!review.section || !review.semester || !review.academicYear) return null
  const matches = offerings.value.filter((offering) => offering.academic_year === review.academicYear && offering.semester === review.semester && normalizedSection(offering.section) === normalizedSection(review.section!))
  return matches.length === 1 && offeringMeetings.value[matches[0].id]?.length ? matches[0] : null
}
function normalizedSection(value: string) { return value.trim().replace(/\s+/g, '').toLocaleLowerCase() }
function isSelected(offering: Offering): boolean { return timetableEntries.value.some((entry) => entry.offering_id === offering.id) }
function hasReportedTime(review: VisibleReview): boolean {
  return !!review.section?.trim() && !!review.semester && !!review.academicYear && !!review.dayOfWeek && !!review.startsAt && !!review.endsAt && isValidMeeting({ day: review.dayOfWeek, start: timeValue(review.startsAt), end: timeValue(review.endsAt) })
}
function isReviewSelected(review: VisibleReview): boolean {
  const offering = reviewOffering(review)
  return (offering ? isSelected(offering) : false) || timetableEntries.value.some((entry) => entry.review_id === review.id)
}
async function addReviewToTimetable(review: VisibleReview) {
  const offering = reviewOffering(review)
  if (offering) { await addToTimetable(offering, review); return }
  if (!hasReportedTime(review) || !timetableService.value || !selected.value) return
  error.value = ''
  try {
    await loadTimetable()
    if (timetableEntries.value.some((entry) => entry.review_id === review.id)) return
    const currentCourse = timetableEntries.value.filter((entry) => entry.course_code === selected.value!.code)
    const conflicts = timetableEntries.value.filter((entry) => entry.course_code !== selected.value!.code && overlaps(
      { day: review.dayOfWeek!, start: timeValue(review.startsAt!), end: timeValue(review.endsAt!) },
      { day: entry.day_of_week, start: timeValue(entry.starts_at), end: timeValue(entry.ends_at) }))
    const messages = [currentCourse.length ? `มี ${selected.value.code} อยู่แล้ว ระบบจะเปลี่ยนเป็นกลุ่ม ${review.section}` : '',
      conflicts.length ? `เวลาเรียนชนกับ ${[...new Set(conflicts.map((entry) => entry.course_code))].join(', ')}` : ''].filter(Boolean)
    if (messages.length && !(await showConfirm(messages.join('\n'), 'ดำเนินการต่อ', 'ยกเลิก', 'warning'))) return
    await timetableService.value.addReview(review.id)
    await loadTimetable()
    showToast(`เพิ่ม ${selected.value.code} ลงตารางเรียนแล้ว`)
    if (!(await showConfirm('ต้องการไปดูหน้าตารางเรียนของคุณตอนนี้เลยไหม?', 'ไปที่ตารางเรียน', 'ปิด', 'success'))) return
    showTimetable()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถเพิ่มลงตารางเรียนได้' }
}
function reviewDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('th-TH') }
function reviewDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) }
function courseFor(review: { courseId: string }): Course | undefined { return courses.value.find((course) => course.id === review.courseId) }
function courseColor(code: string) { return `timetable-color-${(code.charCodeAt(0) + code.charCodeAt(code.length - 1)) % 6}` }
function timetableStyle(entry: TimetableEntry) { const start = Number(timeValue(entry.starts_at).slice(0,2)) * 60 + Number(timeValue(entry.starts_at).slice(3)); const end = Number(timeValue(entry.ends_at).slice(0,2)) * 60 + Number(timeValue(entry.ends_at).slice(3)); return { left: `${Math.max(0, ((start - 480) / 720) * 100)}%`, width: `${Math.min(100, ((end - start) / 720) * 100)}%` } }
async function addToTimetable(offering: Offering, review?: VisibleReview) {
  if (!timetableService.value || !selected.value) return
  error.value = ''
  try {
    const available = await (neon as any).rpc('list_approved_offerings', { p_course_id: selected.value.id })
    if (available.error) throw new Error(available.error.message)
    const latest = (available.data ?? []) as Offering[]
    if (!latest.some((item) => item.id === offering.id)) throw new Error('กลุ่มเรียนนี้ไม่ได้เปิดให้เพิ่มลงตารางแล้ว')
    if (review) {
      const matches = latest.filter((item) => item.academic_year === review.academicYear && item.semester === review.semester && normalizedSection(item.section) === normalizedSection(review.section ?? ''))
      if (matches.length !== 1 || matches[0].id !== offering.id) throw new Error('รีวิวนี้ไม่ตรงกับกลุ่มเรียนที่อนุมัติแล้ว')
    }
    const result = await (neon as any).rpc('list_approved_offering_meetings', { p_offering_id: offering.id })
    if (result.error) throw new Error(result.error.message)
    const meetings = ((result.data ?? []) as Array<{ day_of_week: number; starts_at: string; ends_at: string }>).filter((row) => isValidMeeting({ day: row.day_of_week, start: timeValue(row.starts_at), end: timeValue(row.ends_at) }))
    if (!meetings.length) throw new Error('รายวิชานี้ไม่มีเวลาเรียนที่ใช้งานได้')
    if (review) {
      const latestMeetings = meetings.map((meeting) => ({ day: meeting.day_of_week, start: timeValue(meeting.starts_at), end: timeValue(meeting.ends_at) }))
      if (JSON.stringify(offeringMeetings.value[offering.id]) !== JSON.stringify(latestMeetings)) {
        offeringMeetings.value[offering.id] = latestMeetings
        throw new Error('เวลาเรียนทางการเปลี่ยนไป โปรดตรวจสอบเวลาใหม่ก่อนเพิ่มลงตาราง')
      }
    }
    await loadTimetable()
    if (isSelected(offering)) return
    const currentCourse = timetableEntries.value.filter((entry) => entry.course_code === selected.value!.code)
    const conflicts = timetableEntries.value.filter((entry) => entry.course_code !== selected.value!.code && meetings.some((meeting) => overlaps({ day: meeting.day_of_week, start: timeValue(meeting.starts_at), end: timeValue(meeting.ends_at) }, { day: entry.day_of_week, start: timeValue(entry.starts_at), end: timeValue(entry.ends_at) })))
    const messages = [currentCourse.length ? `มี ${selected.value.code} อยู่แล้ว ระบบจะเปลี่ยนเป็นกลุ่ม ${offering.section}` : '', conflicts.length ? `เวลาเรียนชนกับ ${[...new Set(conflicts.map((entry) => entry.course_code))].join(', ')}` : ''].filter(Boolean)
    if (messages.length && !(await showConfirm(messages.join('\n'), 'ดำเนินการต่อ', 'ยกเลิก', 'warning'))) return
    if (currentCourse.length) await timetableService.value.replace(offering.id); else await timetableService.value.add(offering.id)
    await loadTimetable()
    showToast(`เพิ่ม ${selected.value.code} ลงตารางเรียนแล้ว`)
    if (review && !(await showConfirm('ต้องการไปดูหน้าตารางเรียนของคุณตอนนี้เลยไหม?', 'ไปที่ตารางเรียน', 'ปิด', 'success'))) return
    showTimetable()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถเพิ่มลงตารางเรียนได้' }
}
async function removeFromTimetable(entry: TimetableEntry) { if (!timetableService.value) return; try { if (entry.source === 'reported' && entry.review_id) await timetableService.value.removeReview(entry.review_id); else if (entry.source === 'legacy' && entry.legacy_entry_id) await timetableService.value.removeLegacy(entry.legacy_entry_id); else if (entry.offering_id) await timetableService.value.remove(entry.offering_id); await loadTimetable() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถลบรายวิชาได้' } }
async function confirmRemoveFromTimetable(entry: TimetableEntry) { if (!(await showConfirm(`ต้องการลบวิชา ${entry.course_code} ออกจากตารางเรียนใช่ไหม?`, 'ลบ', 'ยกเลิก', 'warning'))) return; await removeFromTimetable(entry) }
async function clearTimetable() { if (!timetableService.value || !window.confirm('ต้องการล้างตารางเรียนทั้งหมดใช่หรือไม่?')) return; try { await timetableService.value.clear(); await loadTimetable() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถล้างตารางเรียนได้' } }
async function openMyReviews() { if (!service.value) return; myReviewsScreen.value = true; timetable.value = false; dashboard.value = false; error.value = ''; try { myReviews.value = await service.value.listMine() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดรีวิวของฉันได้' } }
async function setMyReviewActive(id: string, active: boolean) { if (!service.value) return; try { await service.value.setMineActive(id, active); myReviews.value = await service.value.listMine() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถเปลี่ยนสถานะรีวิวได้' } }
function beginReviewEdit(review: import('./services/reviews').MyReview) { editingReviewId.value = review.id; editReviewRating.value = review.rating; editReviewText.value = review.text; error.value = '' }
function cancelReviewEdit() { editingReviewId.value = null; editReviewText.value = '' }
async function saveReviewEdit() { if (!service.value || !editingReviewId.value) return; try { await service.value.updateMine(editingReviewId.value, editReviewRating.value, editReviewText.value); myReviews.value = await service.value.listMine(); cancelReviewEdit() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถแก้ไขรีวิวได้' } }
async function toggleReviewHistory(reviewId: string) { if (reviewHistoryId.value === reviewId) { reviewHistoryId.value = null; return }; if (!service.value) return; try { reviewHistory.value = await service.value.listMyRevisions(reviewId); reviewHistoryId.value = reviewId } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดประวัติการแก้ไขได้' } }
async function publish() {
  if (!selected.value) { error.value = 'กรุณาเลือกรายวิชา'; return }
  if (!service.value) { error.value = 'ยังไม่ได้เชื่อมต่อบริการรีวิว กรุณาเข้าสู่ระบบใหม่อีกครั้ง'; return }
  error.value = ''
  publishing.value = true
  try {
    await service.value.create(selected.value.id, { academicYear: reviewYear.value, semester: reviewSemester.value, section: reviewSection.value, instructorName: reviewTeacher.value, dayOfWeek: dayNames.indexOf(reviewDay.value), startsAt: reviewStart.value, endsAt: reviewEnd.value }, rating.value, text.value)
    text.value = ''; reviewFormOpen.value = false; await loadReviews(selected.value.id)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถเผยแพร่รีวิวได้' } finally { publishing.value = false }
}
async function enter() {
  if (embeddedBrowser(navigator.userAgent)) {
    await browserHelp.value?.requestExternalBrowser()
    return
  }
  if (signingIn.value || restoringSession.value) return
  error.value = ''; loginFailureStage.value = null; signingIn.value = true
  try { await signInWithGoogle() }
  catch (cause) { recordAuthFailure('sign-in', cause); loginFailureStage.value = 'sign-in'; error.value = loginErrorMessage }
  finally {
    signingIn.value = false
    if (loginFailureStage.value) {
      await nextTick()
      googleSignInButton.value?.focus()
    }
  }
}
async function loadStartupData() {
  if (!neon || !signedIn.value || startupDataLoading.value) return
  const generation = sessionGeneration
  startupDataLoading.value = true
  const results = await Promise.allSettled([
    (async () => {
      const { data, error: apiError } = await (neon as any).rpc('current_access')
      if (apiError) throw new Error(apiError.message)
      if (generation === sessionGeneration) accessRole.value = data?.[0]?.role ?? null
    })(),
    (async () => {
      const items = await adminService.value!.listCategories()
      if (generation === sessionGeneration) categories.value = items
    })(),
  ])
  if (generation !== sessionGeneration) return
  startupDataErrors.value = []
  if (results[0].status === 'rejected') startupDataErrors.value.push('ตรวจสอบสิทธิ์การใช้งานไม่สำเร็จ บางเมนูอาจยังไม่แสดง')
  if (results[1].status === 'rejected') startupDataErrors.value.push('โหลดหมวดหมู่ไม่สำเร็จ ยังสามารถค้นหารายวิชาได้')
  startupDataLoading.value = false
}
function openDashboard() { if (!accessRole.value) return; dashboard.value = true; error.value = '' }
async function onDashboardCatalogChanged() { await loadCatalog(); if (adminService.value) categories.value = await adminService.value.listCategories() }
function openCourseModal() { courseCode.value = ''; courseName.value = ''; courseCategoryId.value = categories.value[0]?.id ?? ''; error.value = ''; courseModalOpen.value = true }
async function submitCourseModal() {
  if (!adminService.value) return
  try {
    await adminService.value.createCourse({ code: courseCode.value, nameTh: courseName.value, categoryId: courseCategoryId.value })
    courseModalOpen.value = false
    await loadCatalog()
    showToast('เพิ่มรายวิชาสำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถบันทึกรายวิชาได้' }
}
async function submitProposal() { if (!selected.value || !proposalService.value) return; try { await proposalService.value.create(selected.value.id, proposalYear.value, proposalSemester.value, proposalSection.value, proposalInstructor.value); proposalSection.value = ''; proposalInstructor.value = ''; await Promise.all([loadOfferings(selected.value.id), loadMyProposals()]) } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถเพิ่มกลุ่มเรียนได้' } }
async function loadMyProposals() { if (!proposalService.value) return; try { myProposals.value = await proposalService.value.listMine() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดข้อเสนอของฉันได้' } }
async function signOut() {
  await neon?.auth.signOut()
  sessionGeneration += 1
  startupDataErrors.value = []; startupDataLoading.value = false
  catalogInFlight = false; loading.value = false
  categories.value = []
  signedIn.value = false
  courses.value = []
  offerings.value = []
  reviews.value = []
  selected.value = null
  accessRole.value = null
  dashboard.value = false
  timetable.value = false
  myReviewsScreen.value = false
  error.value = ''
  catalogError.value = ''
  accountMenuOpen.value = false
  contactOpen.value = false
  loginFailureStage.value = null
  displayName.value = 'บัญชีของฉัน'
  signedInEmail.value = ''
  activeMigrationUserId = null
  retryEntries = []
}
onMounted(async () => {
  // A browser-opening action explicitly requests Google continuation. Consume
  // it before any auth work so reload, back, cancellation or errors cannot loop.
  const landing = new URL(window.location.href)
  const continueGoogle = landing.searchParams.get('continue') === 'google'
  if (continueGoogle) {
    landing.searchParams.delete('continue')
    history.replaceState(history.state, '', landing)
  }
  if (!neon) { loading.value = false; return }
  let session
  try {
    session = await (neon.auth as any).getSession()
    if (session?.error) throw session.error
  } catch (cause) {
    loading.value = false
    restoringSession.value = false
    loginFailureStage.value = 'session'
    recordAuthFailure('session', cause)
    error.value = loginErrorMessage
    return
  }
  restoringSession.value = false
  signedIn.value = Boolean(session?.data?.user)
  if (!signedIn.value) {
    loading.value = false
    const callback = new URL(window.location.href)
    if (callback.searchParams.get('authError') === 'oauth') {
      loginFailureStage.value = 'sign-in'
      error.value = loginErrorMessage
      recordAuthFailure('sign-in', null)
      callback.searchParams.delete('authError')
      callback.searchParams.delete('error')
      callback.searchParams.delete('error_description')
      history.replaceState(history.state, '', callback)
    } else if (continueGoogle && !inAppBrowser) {
      await enter()
    }
    return
  }
  const user = session.data.user
  displayName.value = user.name || user.email?.split('@')[0] || 'บัญชีของฉัน'
  signedInEmail.value = user.email ?? ''
  activeMigrationUserId = user.id
  // Data errors are handled separately so successful authentication stays intact.
  await Promise.all([loadCatalog(), loadStartupData()])
  if (signedInEmail.value && activeMigrationUserId === user.id) {
    try {
      const source = readLegacyTimetable(signedInEmail.value, window.localStorage)
      if (source.kind === 'found') { retryEntries = source.entries.filter((entry) => !entry.invalidReason); void runLegacyMigration(user.id, retryEntries) }
    } catch { /* Legacy data is optional; the signed-in app stays usable. */ }
  }
})
</script>

<template>
  <main :class="{ 'mobile-timetable-screen': timetableActive, 'catalog-search-focused': searchFocused }">
    <nav v-if="signedIn" class="navbar navbar-custom navbar-dark mb-4">
      <div class="container d-flex justify-content-between align-items-center">
        <button
          class="navbar-brand mb-0 h1 border-0 bg-transparent"
          @click="
            timetable = false;
            dashboard = false;
            myReviewsScreen = false;
            selected = null;
          "
        >
          <i class="bi bi-journal-text me-2"></i>Varasarn Close Friends
        </button>
        <div class="d-none d-md-flex align-items-center gap-2">
          <button
            class="btn btn-sm btn-light text-purple fw-bold rounded-pill px-3 shadow-sm"
            @click="openTimetable"
          >
            <i class="bi bi-grid-3x3-gap-fill me-1"></i>ตารางเรียน
          </button>
          <div class="account-menu d-none d-md-block">
            <button
              class="btn user-dropdown-btn dropdown-toggle"
              type="button"
              :aria-expanded="accountMenuOpen"
              @click="accountMenuOpen = !accountMenuOpen"
            >
              <i class="bi bi-person-circle me-1"></i>{{ displayName }}
            </button>
            <div v-if="accountMenuOpen" class="account-menu-list dropdown-menu-custom">
              <button
                class="dropdown-item py-2"
                @click="
                  accountMenuOpen = false;
                  openMyReviews();
                "
              >
                <i class="bi bi-star-fill text-warning me-2"></i>รีวิวของฉัน</button
              ><button
                v-if="accessRole"
                class="dropdown-item py-2"
                @click="
                  accountMenuOpen = false;
                  openDashboard();
                "
              >
                <i class="bi bi-speedometer2 text-purple me-2" aria-hidden="true"></i>แดชบอร์ดผู้ดูแล
              </button>
              <hr class="dropdown-divider" />
              <button
                class="dropdown-item py-2 text-danger fw-bold"
                @click="
                  accountMenuOpen = false;
                  signOut();
                "
              >
                <i class="bi bi-box-arrow-right me-2"></i>ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
    <section v-if="!signedIn" class="sign-in">
      <div class="login-shell">
        <div class="login-card">
          <div class="login-banner">
            <img
              src="https://i.postimg.cc/FFk3NRHV/IMG-0677.jpg"
              alt="Varasarn Close Friends"
            />
          </div>
          <p class="login-description">
            พื้นที่รวบรวมรีวิววิชาเรียนและจัดตารางเรียนส่วนตัว<br />ดูแลโดย กน.วส.
          </p>
          <div class="login-actions">
          <div v-if="error" class="login-error-notice" role="alert" aria-atomic="true">
            <i class="bi bi-exclamation-circle login-error-icon" aria-hidden="true"></i>
            <div>
              <h2>{{ loginFailureTitle }}</h2>
              <p id="login-error-description">{{ loginFailureDescription }}</p>
            </div>
          </div>
          <button v-if="!inAppBrowser" ref="googleSignInButton" class="google-signin-btn" :class="{ 'is-retry': Boolean(error) }" :disabled="signingIn || restoringSession" :aria-busy="signingIn || restoringSession" :aria-describedby="error ? 'login-error-description' : undefined" @click="enter">
            <svg class="google-mark" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M21.35 12.27c0-.72-.06-1.42-.18-2.09H12v3.96h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.26Z"
              />
              <path
                fill="#34A853"
                d="M12 21.7c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.03H3.28v2.53A9.74 9.74 0 0 0 12 21.7Z"
              />
              <path
                fill="#FBBC05"
                d="M6.53 13.78A5.86 5.86 0 0 1 6.22 12c0-.62.11-1.22.31-1.78V7.69H3.28A9.73 9.73 0 0 0 2.25 12c0 1.57.38 3.05 1.03 4.31l3.25-2.53Z"
              />
              <path
                fill="#EA4335"
                d="M12 6.19c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.19 14.63 2.3 12 2.3a9.74 9.74 0 0 0-8.72 5.39l3.25 2.53C7.3 7.91 9.46 6.19 12 6.19Z"
              /></svg
            ><span>{{ signingIn ? 'กำลังเปิด Google…' : error ? 'ลองเข้าสู่ระบบอีกครั้ง' : 'เข้าสู่ระบบด้วย Google' }}</span>
          </button>
          <p class="login-progress" role="status" aria-live="polite">{{ restoringSession ? 'กำลังตรวจสอบการเข้าสู่ระบบ…' : signingIn ? 'กำลังพาไปหน้าเข้าสู่ระบบของ Google' : '' }}</p>
          <LoginBrowserHelp v-if="inAppBrowser" ref="browserHelp" :failed="Boolean(error)" />
          <p v-if="error" class="login-support">ยังเข้าไม่ได้? <a href="https://line.me/R/ti/p/@293shldn" target="_blank" rel="noopener noreferrer">ติดต่อผู้ดูแล<i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a></p>
          </div>
        </div>
      </div>
    </section>
    <section v-else class="container app-body">
      <div v-if="startupDataErrors.length" class="alert alert-warning startup-data-warning" role="alert" :aria-busy="startupDataLoading">
        <p v-for="message in startupDataErrors" :key="message" class="mb-1">{{ message }}</p>
        <p class="small mb-2">กรุณาลองโหลดอีกครั้ง หากยังพบปัญหา กรุณาติดต่อผู้ดูแล</p>
        <button class="btn btn-sm btn-outline-purple startup-data-retry" type="button" :disabled="startupDataLoading" @click="loadStartupData">
          <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>{{ startupDataLoading ? 'กำลังโหลด…' : 'ลองอีกครั้ง' }}
        </button>
      </div>
      <div v-if="!timetableActive" class="mobile-navigation-row d-md-none mb-3">
        <div class="mobile-account-menu">
          <button
            class="btn user-dropdown-btn dropdown-toggle w-100 text-start d-flex justify-content-between align-items-center"
            type="button"
            :aria-expanded="accountMenuOpen"
            @click="accountMenuOpen = !accountMenuOpen"
          >
            <span class="mobile-account-name"><i class="bi bi-person-circle me-1"></i>{{ displayName }}</span>
          </button>
          <div v-if="accountMenuOpen" class="account-menu-list dropdown-menu-custom w-100">
            <button
              class="dropdown-item py-2"
              @click="
                accountMenuOpen = false;
                openMyReviews();
              "
            >
              <i class="bi bi-star-fill text-warning me-2"></i>รีวิวของฉัน</button
            ><button
              v-if="accessRole"
              class="dropdown-item py-2"
              @click="
                accountMenuOpen = false;
                openDashboard();
              "
            >
              <i class="bi bi-speedometer2 text-purple me-2" aria-hidden="true"></i>แดชบอร์ดผู้ดูแล
            </button>
            <hr class="dropdown-divider" />
            <button
              class="dropdown-item py-2 text-danger fw-bold"
              @click="
                accountMenuOpen = false;
                signOut();
              "
            >
              <i class="bi bi-box-arrow-right me-2"></i>ออกจากระบบ
            </button>
          </div>
        </div>
        <button
          class="btn btn-sm btn-light text-purple fw-bold rounded-pill px-3 shadow-sm mobile-timetable-btn"
          @click="openTimetable"
        >
          <i class="bi bi-grid-3x3-gap-fill me-1"></i>ตารางเรียน
        </button>
      </div>
      <AdminDashboard
        v-if="dashboard && accessRole"
        :client="(neon as any)"
        :role="accessRole"
        @close="dashboard = false"
        @catalog-changed="onDashboardCatalogChanged"
        @toast="showToast"
      />
      <section v-else-if="timetable">
        <div
          class="screen-header d-none d-md-flex justify-content-between align-items-center mb-4 border-bottom pb-3"
        >
          <div>
            <h1 class="h3 text-purple">
              <i class="bi bi-grid-3x3-gap-fill me-2"></i>ตารางเรียนส่วนตัว
            </h1>
            <p class="text-muted mb-0">
              My Timetable วางแผนการเรียนของคุณได้ง่ายๆ (คลิกที่วิชาเพื่อลบออก)
            </p>
          </div>
          <div class="screen-header-actions d-flex gap-2">
            <button class="btn btn-outline-danger shadow-sm" @click="clearTimetable">
              <i class="bi bi-trash-fill me-1"></i>ล้างตาราง</button
            ><button class="btn btn-purple shadow-sm" @click="returnToCatalog">
              <i class="bi bi-arrow-left-circle-fill me-1"></i>หน้าหลัก
            </button>
          </div>
        </div>
        <header class="timetable-mobile-header d-md-none">
          <div class="timetable-mobile-bar">
            <button class="timetable-mobile-icon" aria-label="กลับหน้ารายวิชา" @click="returnToCatalog">
              <i class="bi bi-arrow-left" aria-hidden="true"></i>
            </button>
            <h1 id="timetable-mobile-title">ตารางเรียน</h1>
            <div class="timetable-mobile-account">
              <button
                ref="timetableAccountButton"
                class="timetable-mobile-icon"
                type="button"
                :aria-label="`เมนูบัญชี ${displayName}`"
                :aria-expanded="accountMenuOpen"
                aria-haspopup="true"
                @click="accountMenuOpen = !accountMenuOpen"
                @keydown.esc.stop.prevent="closeTimetableAccountMenu"
              >
                <i class="bi bi-person-circle" aria-hidden="true"></i>
              </button>
              <div v-if="accountMenuOpen" class="account-menu-list dropdown-menu-custom timetable-account-menu" @keydown.esc.stop.prevent="closeTimetableAccountMenu">
                <p class="timetable-account-name">{{ displayName }}</p>
                <button class="dropdown-item py-2" @click="accountMenuOpen = false; openMyReviews()">
                  <i class="bi bi-star-fill text-warning me-2"></i>รีวิวของฉัน
                </button>
                <button v-if="accessRole" class="dropdown-item py-2" @click="accountMenuOpen = false; openDashboard()"><i class="bi bi-speedometer2 text-purple me-2" aria-hidden="true"></i>แดชบอร์ดผู้ดูแล</button>
                <hr class="dropdown-divider" />
                <button class="dropdown-item py-2" @click="accountMenuOpen = false; clearTimetable()">
                  <i class="bi bi-trash-fill text-danger me-2"></i>ล้างตาราง
                </button>
                <button class="dropdown-item py-2" @click="accountMenuOpen = false; contactOpen = true">
                  <i class="bi bi-chat-heart-fill me-2"></i>แจ้งปัญหา/ติดต่อ
                </button>
                <hr class="dropdown-divider" />
                <button class="dropdown-item py-2 text-danger fw-bold" @click="accountMenuOpen = false; signOut()">
                  <i class="bi bi-box-arrow-right me-2"></i>ออกจากระบบ
                </button>
              </div>
            </div>
          </div>
          <div class="timetable-weekdays" role="group" aria-label="เลือกวันเรียน">
            <button
              v-for="(shortName, index) in shortDayNames"
              :key="shortName"
              class="timetable-day-button"
              type="button"
              :aria-label="`เลือกวัน${dayNames[index + 1]}`"
              :aria-pressed="selectedTimetableDay === index + 1"
              :class="{ 'is-selected': selectedTimetableDay === index + 1 }"
              @click="selectedTimetableDay = index + 1"
            >{{ shortName }}</button>
          </div>
          <p class="timetable-day-summary" aria-live="polite">
            <span class="visually-hidden">วัน{{ dayNames[selectedTimetableDay] }}: </span>
            <template v-if="timetableLoading">กำลังโหลดตารางเรียน…</template>
            <template v-else-if="!timetableEntries.length && error">ไม่สามารถโหลดตารางเรียนได้</template>
            <template v-else-if="!timetableEntries.length">ตารางเรียนยังว่างเปล่า</template>
            <template v-else-if="selectedDayEntries.length">{{ selectedDayEntries.length }} คาบเรียน · แตะวิชาเพื่อลบ</template>
            <template v-else>ไม่มีคาบเรียน</template>
          </p>
        </header>
        <p v-if="error" class="text-danger timetable-error" role="alert">{{ error }}</p>
        <div v-if="timetableLoading && !timetableEntries.length" class="timetable-day-view d-md-none" role="status">กำลังโหลดตารางเรียน…</div>
        <div v-else-if="!timetableEntries.length && !error" class="timetable-empty-mobile d-md-none">
          <i class="bi bi-calendar-x" aria-hidden="true"></i>
          <h2>ตารางเรียนยังว่างเปล่า</h2>
          <p>กลับหน้ารายวิชาเพื่อเพิ่มวิชาลงตาราง</p>
        </div>
        <div v-else-if="selectedDayEntries.length" class="timetable-day-view d-md-none" :aria-label="`ตารางเรียนวัน${dayNames[selectedTimetableDay]}`">
          <div v-if="timetableListFallback" class="timetable-day-list">
            <button
              v-for="entry in selectedDayEntries"
              :key="timetableMeetingKey(entry)"
              class="timetable-day-course timetable-day-course-list"
              :class="courseColor(entry.course_code)"
              :aria-label="timetableEntryLabel(entry)"
              @click="confirmRemoveFromTimetable(entry)"
            >
              <span class="timetable-day-course-time">{{ timeValue(entry.starts_at) }}–{{ timeValue(entry.ends_at) }}</span>
              <span class="timetable-day-course-details">
                <strong class="timetable-day-course-code">{{ entry.course_code }} · กลุ่ม {{ entry.section }}</strong>
                <span class="timetable-day-course-name">{{ entry.course_name }}</span>
                <span v-if="entry.instructor_name" class="timetable-day-course-instructor">{{ entry.instructor_name }}</span>
              </span>
            </button>
          </div>
          <div v-else class="timetable-day-timeline" :style="{ height: `calc(var(--timetable-hour-height) * ${timelineHours.length - 1})` }">
            <div v-for="(hour, index) in timelineHours" :key="hour" class="timetable-day-hour" :style="{ top: `calc(var(--timetable-hour-height) * ${index})` }" aria-hidden="true">
              <span>{{ String(hour).padStart(2, '0') }}:00</span><span class="timetable-day-hour-line"></span>
            </div>
            <button
              v-for="entry in selectedDayEntries"
              :key="timetableMeetingKey(entry)"
              class="timetable-day-course"
              :class="[courseColor(entry.course_code), { 'timetable-day-course-short': timetableDuration(entry) < 60 }]"
              :style="timetableDayStyle(entry)"
              :aria-label="timetableEntryLabel(entry)"
              @click="confirmRemoveFromTimetable(entry)"
            >
              <strong class="timetable-day-course-code">{{ entry.course_code }} · กลุ่ม {{ entry.section }}</strong>
              <span class="timetable-day-course-time">{{ timeValue(entry.starts_at) }}–{{ timeValue(entry.ends_at) }}</span>
              <span v-if="timetableDuration(entry) >= 60" class="timetable-day-course-name">{{ entry.course_name }}</span>
              <span v-if="timetableDuration(entry) >= 60 && entry.instructor_name" class="timetable-day-course-instructor">{{ entry.instructor_name }}</span>
            </button>
          </div>
        </div>
        <div v-else-if="timetableEntries.length && !timetableLoading" class="timetable-empty-day d-md-none">
          <i class="bi bi-calendar-check" aria-hidden="true"></i>
          <h2>ไม่มีเรียนวัน{{ dayNames[selectedTimetableDay] }}</h2>
        </div>
        <div v-if="!timetableEntries.length && !timetableLoading && !error" class="review-box text-center py-5 d-none d-md-block">
          <i class="bi bi-calendar-x" style="font-size: 5rem; color: var(--line)"></i>
          <h2 class="h4 text-purple mt-4">ตารางเรียนยังว่างเปล่า</h2>
          <p class="text-muted">กลับไปที่หน้าหลักแล้วกด "เพิ่มลงตาราง" ในรายละเอียดวิชากันเลย!</p>
          <button class="btn btn-purple mt-3 px-4" @click="returnToCatalog">ไปเลือกวิชาเรียน</button>
        </div>
        <template v-if="timetableEntries.length">
          <div class="timetable-container d-none d-md-block">
            <div class="timetable-grid">
              <div class="time-header-row">
                <div v-for="hour in 12" :key="hour" class="time-header-slot">
                  {{ String(hour + 7).padStart(2, "0") }}:00
                </div>
              </div>
              <div v-for="day in [1, 2, 3, 4, 5, 6, 7]" :key="day" class="day-row">
                <div class="day-label">{{ dayNames[day] }}</div>
                <div class="day-track">
                  <div
                    v-for="entry in timetableEntries.filter(
                      (item) => item.day_of_week === day
                    )"
                    :key="timetableMeetingKey(entry)"
                    class="timetable-course"
                    :class="courseColor(entry.course_code)"
                    :style="timetableStyle(entry)"
                    title="คลิกเพื่อลบวิชานี้"
                    @click="confirmRemoveFromTimetable(entry)"
                  >
                    <strong>{{ entry.course_code }} ({{ entry.section }})</strong
                    ><span v-if="entry.instructor_name" class="text-truncate">{{
                      entry.instructor_name
                    }}</span
                    ><span
                      >{{ timeValue(entry.starts_at) }}–{{
                        timeValue(entry.ends_at)
                      }}</span
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="false" class="review-box">
            <h2 class="h5">รายวิชาที่เลือก</h2>
            <div
              v-for="entry in timetableEntries.filter(
                (item, index, items) =>
                  items.findIndex(
                    (other) =>
                      (other.offering_id ?? other.review_id ?? other.legacy_entry_id) ===
                      (item.offering_id ?? item.review_id ?? item.legacy_entry_id)
                  ) === index
              )"
              :key="entry.offering_id ?? entry.review_id ?? entry.legacy_entry_id!"
              class="d-flex justify-content-between align-items-center border-bottom py-2"
            >
              <span
                ><strong>{{ entry.course_code }}</strong> {{ entry.course_name }} · กลุ่ม
                {{ entry.section
                }}<small v-if="entry.source === 'reported'" class="text-muted">
                  · ข้อมูลจากรีวิว</small
                ></span
              ><button
                class="btn btn-sm btn-outline-danger"
                @click="removeFromTimetable(entry)"
              >
                ลบออก
              </button>
            </div>
          </div></template
        >
      </section>
      <section v-else-if="myReviewsScreen">
        <div
          class="screen-header d-flex justify-content-between align-items-center mb-4 border-bottom pb-3"
        >
          <div>
            <h1 class="h3 text-purple">
              <i class="bi bi-star-fill text-warning me-2"></i>รีวิวของฉัน
            </h1>
            <p class="text-muted mb-0">จัดการรีวิวทั้งหมดที่คุณเคยเขียนไว้ที่นี่</p>
          </div>
          <div class="screen-header-actions"><button class="btn btn-purple shadow-sm" @click="myReviewsScreen = false">
            <i class="bi bi-arrow-left-circle-fill me-1"></i>หน้าหลัก
          </button></div>
        </div>
        <p v-if="error" class="text-danger" role="alert">{{ error }}</p>
        <p v-if="!myReviews.length" class="review-box text-muted">
          คุณยังไม่เคยเขียนรีวิว
        </p>
        <article v-for="review in myReviews" :key="review.id" class="review-box">
          <h5 class="text-purple fw-bold mb-1">
            {{ courseFor(review)?.code ?? "ไม่พบข้อมูลรายวิชา" }}
          </h5>
          <p v-if="courseFor(review)" class="text-muted small mb-2">
            {{ courseFor(review)!.name_th }}
          </p>
          <div class="d-flex justify-content-between align-items-center mb-3">
            <StarRating class="stars" :value="review.rating" :label="`ให้คะแนน ${review.rating} จาก 5 ดาว`" />
            <span
              class="badge"
              :class="review.active ? 'selected-badge' : 'bg-light text-dark border'"
              >{{ review.active ? "เผยแพร่แล้ว" : "ถอนการเผยแพร่" }}</span
            >
          </div>
          <template v-if="editingReviewId === review.id"
            ><label class="form-label" :for="`edit-rating-${review.id}`">คะแนนรวม</label
            ><select
              :id="`edit-rating-${review.id}`"
              v-model="editReviewRating"
              class="form-select mb-3"
            >
              <option v-for="n in 5" :key="n" :value="n">{{ n }} ดาว</option></select
            ><label class="form-label" :for="`edit-text-${review.id}`">ความคิดเห็น</label
            ><textarea
              :id="`edit-text-${review.id}`"
              v-model="editReviewText"
              class="form-control mb-3"
              rows="3"
            ></textarea>
            <div class="d-flex gap-2 review-edit-actions">
              <button class="btn btn-outline-secondary" @click="cancelReviewEdit">
                ยกเลิก</button
              ><button class="btn btn-purple" @click="saveReviewEdit">บันทึก</button>
            </div></template
          ><template v-else
            ><p class="text-break">{{ review.text }}</p>
            <div class="my-review-footer d-flex justify-content-between align-items-end mt-4">
              <small class="my-review-date text-muted"
                ><i class="bi bi-clock me-1"></i
                >{{ reviewDateTime(review.createdAt) }}</small
              >
              <div class="my-review-actions d-flex gap-2">
                <button
                  class="btn btn-sm btn-outline-purple px-3 rounded-pill"
                  @click="beginReviewEdit(review)"
                >
                  <i class="bi bi-pencil-fill me-1"></i>แก้ไข</button
                ><button
                  v-if="review.active"
                  class="btn btn-sm btn-outline-danger px-3 rounded-pill"
                  @click="setMyReviewActive(review.id, false)"
                >
                  ถอนรีวิว</button
                ><button
                  v-else
                  class="btn btn-sm btn-purple px-3 rounded-pill"
                  @click="setMyReviewActive(review.id, true)"
                >
                  เผยแพร่อีกครั้ง</button
                ><button
                  class="btn btn-sm btn-outline-secondary px-3 rounded-pill"
                  @click="toggleReviewHistory(review.id)"
                >
                  <i class="bi bi-clock-history me-1"></i
                  >{{
                    reviewHistoryId === review.id ? "ซ่อนประวัติ" : "ดูประวัติการแก้ไข"
                  }}
                </button>
              </div>
            </div>
            <div v-if="reviewHistoryId === review.id" class="mt-3 border-top pt-3">
              <p v-if="!reviewHistory.length" class="text-muted mb-0">
                ยังไม่มีการแก้ไขก่อนหน้านี้
              </p>
              <div v-for="revision in reviewHistory" :key="revision.id" class="mb-2">
                <small class="text-muted d-block"
                  ><StarRating class="stars" :value="revision.rating" :label="`ให้คะแนน ${revision.rating} จาก 5 ดาว`" /> ·
                  {{ reviewDateTime(revision.revisedAt) }}</small
                >
                <p class="mb-0 text-break">{{ revision.text }}</p>
              </div>
            </div></template
          >
        </article>
      </section>
      <template v-else>
        <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
        <h1 class="visually-hidden">Varasarn Close Friends</h1>
        <div class="mb-4 mt-2 hero-banner">
          <img
            src="https://i.postimg.cc/FFk3NRHV/IMG-0677.jpg"
            class="img-fluid w-100"
            alt="Banner แนะนำรายวิชา"
          />
        </div>
        <div class="about alert shadow-sm mb-4">
          <div class="text-center p-2 p-md-3">
            <h2 class="h5 text-purple fw-bold mb-3">
              <i class="bi bi-info-circle-fill me-2"></i>เกี่ยวกับ Varasarn Close
              Friends
            </h2>
            <p class="mb-3 about-description">
              เว็บไซต์รวบรวมรีวิววิชาเรียนของคณะวารสารศาสตร์และสื่อสารมวลชน<br
                class="d-none d-md-block"
              />ทั้งหลักสูตรภาคปกติ (JC) และหลักสูตรนานาชาติ (BJM)
              เป็นพื้นที่รวบรวมความคิดเห็นจากนักศึกษา<br /><span
                class="about-owner fw-bold"
                >ดูแลโดยคณะกรรมการนักศึกษา (กน.วส.)</span
              >
            </p>
            <div class="about-contact d-inline-block px-4 py-2 mt-2">
              <small class="text-muted fw-medium"
                ><i class="bi bi-headset me-1"></i>พบปัญหาหรือต้องการสอบถามติดต่อ</small
              ><a
                href="https://www.instagram.com/varasarn_official"
                target="_blank"
                rel="noopener noreferrer"
                class="about-instagram text-decoration-none fw-bold ms-2"
                ><i class="bi bi-instagram me-1"></i>IG : varasarn_official</a
              >
            </div>
          </div>
        </div>
        <div
          class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2"
        >
          <h2 class="h4 mb-0 section-label">รายวิชาทั้งหมด</h2>
          <button
            v-if="accessRole"
            class="btn btn-outline-purple shadow-sm add-course-btn"
            @click="openCourseModal"
          >
            <i class="bi bi-plus-lg me-1"></i>เพิ่มรายวิชาใหม่
          </button>
        </div>
        <div :ref="setToolbarSentinel" class="catalog-toolbar-sentinel" aria-hidden="true"></div>
        <div class="catalog-toolbar" :class="{ 'is-stuck': toolbarStuck }">
          <div class="search-wrap">
            <i class="bi bi-search search-icon" aria-hidden="true"></i
            ><input
              v-model="searchTerm"
              type="search"
              class="form-control shadow-sm"
              placeholder="ค้นหารหัสวิชา หรือ ชื่อวิชา..."
              aria-label="ค้นหารหัสวิชา หรือ ชื่อวิชา"
              @focus="searchFocused = true"
              @blur="searchFocused = false"
            /><button
              v-if="searchTerm"
              class="search-clear"
              type="button"
              aria-label="ล้างคำค้นหา"
              @click="searchTerm = ''"
            >
              <i class="bi bi-x-circle-fill" aria-hidden="true"></i>
            </button>
          </div>
          <div class="catalog-toolbar-actions">
            <button
              class="btn category-btn catalog-reviewed-toggle"
              :class="reviewedOnly ? 'btn-purple' : 'btn-outline-purple'"
              type="button"
              :aria-pressed="reviewedOnly"
              @click="reviewedOnly = !reviewedOnly"
            >
              <i class="bi bi-star-fill me-1" aria-hidden="true"></i>มีรีวิว<span v-if="catalogCountsAvailable" class="category-count">{{ reviewedCount }}</span>
            </button>
            <div class="catalog-sort-control">
              <label for="catalog-sort" class="visually-hidden">เรียงตาม:</label>
              <select id="catalog-sort" v-model="catalogSort" class="form-select catalog-sort">
                <option value="code">รหัสวิชา</option>
                <option value="rating">★ คะแนนสูงสุด</option>
                <option value="reviews">รีวิวมากสุด</option>
              </select>
            </div>
          </div>
          <div class="catalog-categories" :class="{ 'is-expanded': categoriesExpanded }">
            <div id="catalog-categories" class="category-menu" role="group" aria-label="กรองตามหมวดหมู่">
              <button
                class="btn category-btn"
                :class="categoryFilter ? 'btn-outline-purple' : 'btn-purple'"
                type="button"
                :aria-pressed="!categoryFilter"
                @click="selectCategory('', $event)"
              >
                ทั้งหมด<span v-if="catalogCountsAvailable" class="category-count">{{ searchAndReviewedCount }}</span></button
              ><button
                v-for="category in categories"
                :key="category.id"
                class="btn category-btn"
                :class="[
                  categoryFilter === category.name ? 'btn-purple' : 'btn-outline-purple',
                  { 'is-empty': catalogCountsAvailable && !categoryCounts[category.name] },
                ]"
                type="button"
                :aria-pressed="categoryFilter === category.name"
                @click="selectCategory(category.name, $event)"
              >
                {{ category.name }}<span v-if="catalogCountsAvailable" class="category-count">{{ categoryCounts[category.name] ?? 0 }}</span>
              </button>
            </div>
            <button class="btn btn-outline-purple catalog-category-disclosure" type="button"
              aria-controls="catalog-categories" :aria-expanded="categoriesExpanded" @click="categoriesExpanded = !categoriesExpanded">
              {{ categoriesExpanded ? 'ย่อหมวด' : 'ทุกหมวด' }}
              <i class="bi" :class="categoriesExpanded ? 'bi-chevron-up' : 'bi-chevron-down'" aria-hidden="true"></i>
            </button>
          </div>
          <p class="catalog-result-count visually-hidden" role="status" aria-live="polite">
            <template v-if="loading && !courses.length">กำลังโหลด…</template>
            <template v-else-if="catalogError && !courses.length">โหลดรายวิชาไม่สำเร็จ</template>
            <template v-else-if="catalogFiltered">พบ {{ filteredCourses.length }}<span class="d-none d-sm-inline"> จาก {{ courses.length }}</span> วิชา</template>
            <template v-else>ทั้งหมด {{ courses.length }} วิชา</template>
          </p>
        </div>
        <div
          v-if="catalogError && courses.length"
          class="alert alert-warning catalog-load-warning d-flex align-items-center justify-content-between flex-wrap gap-2"
          role="alert"
        >
          <span><i class="bi bi-exclamation-triangle-fill me-2" aria-hidden="true"></i>โหลดรายวิชาได้ไม่ครบ รายการด้านล่างอาจยังไม่ครบทุกวิชา</span>
          <button class="btn btn-sm btn-outline-purple catalog-retry" type="button" :disabled="loading" @click="loadCatalog">
            <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>ลองอีกครั้ง
          </button>
        </div>
        <div v-if="loading && !courses.length" class="row" aria-busy="true">
          <div v-for="n in 6" :key="n" class="col-md-4 mb-4" aria-hidden="true">
            <div class="course-card course-card-skeleton">
              <span class="skeleton-line skeleton-badge"></span>
              <span class="skeleton-line skeleton-code"></span>
              <span class="skeleton-line"></span>
              <span class="skeleton-line skeleton-short"></span>
            </div>
          </div>
        </div>
        <div v-else-if="catalogError && !courses.length" class="catalog-state" role="alert">
          <i class="bi bi-cloud-slash catalog-state-icon" aria-hidden="true"></i>
          <h3 class="h5 text-purple">โหลดรายวิชาไม่สำเร็จ</h3>
          <p class="text-muted small mb-3">{{ catalogError }}</p>
          <button class="btn btn-purple px-4 catalog-retry" type="button" @click="loadCatalog">
            <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>ลองอีกครั้ง
          </button>
        </div>
        <template v-else>
          <div class="row">
            <article
              v-for="course in filteredCourses"
              :key="course.id"
              class="col-md-4 mb-4"
            >
              <button
                class="course-card card text-start w-100"
                @click="openCourse(course)"
              >
                <span class="card-body"
                  ><span class="badge">{{ course.category_name }}</span
                  ><span class="card-title text-purple fw-bold h5 d-block">{{
                    course.code
                  }}</span
                  ><span class="card-text d-block">{{ course.name_th }}</span>
                  <span
                    v-if="course.review_count && course.average_rating !== null && course.average_rating !== undefined"
                    class="course-rating-summary"
                  >
                    <StarRating class="stars" :value="course.average_rating" :label="`คะแนนเฉลี่ย ${course.average_rating.toFixed(1)} จาก 5 จาก ${course.review_count} รีวิว`" />
                    <span aria-hidden="true">{{ course.average_rating.toFixed(1) }} · {{ course.review_count }} รีวิว</span>
                  </span></span
                >
              </button>
            </article>
          </div>
          <div v-if="!filteredCourses.length" class="catalog-state catalog-empty">
            <i class="bi bi-search catalog-state-icon" aria-hidden="true"></i>
            <h3 class="h5 text-purple">
              <template v-if="searchTerm.trim()">ไม่พบรายวิชาที่ตรงกับ “{{ searchTerm.trim() }}”</template>
              <template v-else>ไม่พบรายวิชาที่ตรงกับตัวกรอง</template>
            </h3>
            <p class="text-muted small mb-3">ลองค้นหาด้วยรหัสวิชา เช่น JC221 หรือบางส่วนของชื่อวิชา</p>
            <div class="d-flex flex-wrap justify-content-center gap-2">
              <button v-if="searchTerm" class="btn btn-outline-purple" type="button" @click="searchTerm = ''">ล้างคำค้นหา</button>
              <button v-if="categoryFilter" class="btn btn-outline-purple" type="button" @click="categoryFilter = ''">ดูทุกหมวด</button>
              <button v-if="reviewedOnly" class="btn btn-outline-purple" type="button" @click="reviewedOnly = false">รวมวิชาที่ยังไม่มีรีวิว</button>
            </div>
          </div>
        </template>
        <section
          v-if="selected"
          class="course-review-modal"
          @click.self="selected = null"
        >
          <div class="course-review-dialog">
            <header class="course-review-header">
              <h1>
                <i class="bi bi-book-half me-2"></i>{{ selected.code }} -
                {{ selected.name_th }}
              </h1>
              <button
                class="btn-close btn-close-white"
                aria-label="ปิด"
                @click="selected = null"
              ></button>
            </header>
            <div class="course-review-body">
              <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
              <div
                class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2"
              >
                <h2 class="section-label mb-0">💬 รีวิวและเวลาเรียน</h2>
                <button
                  class="btn btn-purple btn-sm shadow-sm"
                  @click="reviewFormOpen = !reviewFormOpen"
                >
                  <i class="bi bi-pencil-square me-1"></i>เขียนรีวิว / เพิ่มเซคชั่น
                </button>
              </div>
              <div v-if="reviewFormOpen" class="review-form-card mb-4">
                <h3 class="section-label mb-3">✍️ เขียนรีวิว &amp; ข้อมูลเวลาเรียน</h3>
                <div class="row mb-3">
                  <div class="col-md-6 mb-3 mb-md-0">
                    <label for="review-semester">เทอมที่เรียน</label
                    ><select
                      id="review-semester"
                      v-model="reviewSemester"
                      class="form-select"
                    >
                      <option value="">เลือก...</option>
                      <option value="1">เทอม 1</option>
                      <option value="2">เทอม 2</option>
                      <option value="ฤดูร้อน">ฤดูร้อน</option>
                    </select>
                  </div>
                  <div class="col-md-6">
                    <label for="review-year">ปีการศึกษา</label
                    ><select
                      id="review-year"
                      v-model.number="reviewYear"
                      class="form-select"
                    >
                      <option :value="0">เลือก...</option>
                      <option
                        v-for="year in [2569, 2568, 2567, 2566, 2565]"
                        :key="year"
                        :value="year"
                      >
                        {{ year }}
                      </option>
                    </select>
                  </div>
                </div>
                <div class="row mb-3">
                  <div class="col-md-6 mb-3 mb-md-0">
                    <label for="review-teacher">อาจารย์ผู้สอน</label
                    ><input
                      id="review-teacher"
                      class="form-control"
                      v-model="reviewTeacher"
                      placeholder="ชื่ออาจารย์"
                    />
                  </div>
                  <div class="col-md-6">
                    <label for="review-section">กลุ่มเรียน (เช่น Sec 01)</label
                    ><input
                      id="review-section"
                      class="form-control"
                      v-model="reviewSection"
                      placeholder="Sec..."
                    />
                  </div>
                </div>
                <div class="row mb-3">
                  <div class="col-md-4 mb-3 mb-md-0">
                    <label for="review-day">วัน</label
                    ><select id="review-day" v-model="reviewDay" class="form-select">
                      <option v-for="day in dayNames.slice(1)" :key="day" :value="day">
                        {{ day }}
                      </option>
                    </select>
                  </div>
                  <div class="col-md-4 mb-3 mb-md-0">
                    <label for="review-start">เวลาเริ่ม (น.)</label
                    ><input
                      id="review-start"
                      class="form-control"
                      v-model="reviewStart"
                      type="time"
                    />
                  </div>
                  <div class="col-md-4">
                    <label for="review-end">เวลาเลิก (น.)</label
                    ><input
                      id="review-end"
                      class="form-control"
                      v-model="reviewEnd"
                      type="time"
                    />
                  </div>
                </div>
                <div class="mb-3">
                  <label for="rating">ให้คะแนน (1-5 ดาว)</label
                  ><select id="rating" v-model="rating" class="form-select">
                    <option v-for="n in 5" :key="n" :value="n">{{ n }} ดาว</option>
                  </select>
                </div>
                <div class="mb-4">
                  <label for="review">ประสบการณ์ที่เจอ</label
                  ><textarea
                    id="review"
                    v-model="text"
                    class="form-control"
                    rows="3"
                  ></textarea>
                </div>
                <button
                  class="btn btn-purple w-100 py-2"
                  :disabled="publishing"
                  @click="publish"
                >
                  <i class="bi bi-save me-1"></i
                  >{{ publishing ? "กำลังบันทึก..." : "บันทึกข้อมูล" }}
                </button>
              </div>
              <div
                v-for="offering in offerings"
                :key="offering.id"
                class="offering-card mb-3"
              >
                <div class="d-flex justify-content-between align-items-center gap-2">
                  <span class="offering-term"
                    >เทอม {{ offering.semester }}/{{ offering.academic_year }}</span
                  ><button
                    class="btn btn-sm btn-success"
                    @click="addToTimetable(offering)"
                  >
                    <i class="bi bi-pin-angle-fill me-1"></i>เพิ่มลงตาราง
                  </button>
                </div>
                <div class="offering-meta mt-3">
                  <strong>กลุ่ม {{ offering.section }}</strong
                  ><span v-if="offering.instructor_name">
                    · {{ offering.instructor_name }}</span
                  >
                </div>
              </div>
              <div v-if="false" class="review-box proposal-box">
                <h2>ไม่พบกลุ่มเรียนที่ต้องการ?</h2>
                <p class="text-muted">
                  เพิ่มข้อมูลกลุ่มเรียนที่ต้องการได้ทันที ข้อมูลนี้แยกจากการเขียนรีวิว
                </p>
                <div class="row g-2">
                  <div class="col-md-3">
                    <input
                      v-model.number="proposalYear"
                      type="number"
                      class="form-control"
                      aria-label="ปีการศึกษาที่เสนอ"
                    />
                  </div>
                  <div class="col-md-2">
                    <input
                      v-model="proposalSemester"
                      class="form-control"
                      placeholder="ภาค"
                    />
                  </div>
                  <div class="col-md-3">
                    <input
                      v-model="proposalSection"
                      class="form-control"
                      placeholder="กลุ่มเรียน"
                    />
                  </div>
                  <div class="col-md-4">
                    <input
                      v-model="proposalInstructor"
                      class="form-control"
                      placeholder="ผู้สอน (ถ้าทราบ)"
                    />
                  </div>
                </div>
                <button class="btn btn-outline-purple mt-3" @click="submitProposal">
                  เพิ่มกลุ่มเรียน
                </button>
                <div
                  v-if="myProposals.filter((proposal) => proposal.courseId === selected!.id).length"
                  class="mt-3"
                >
                  <h3 class="h6">กลุ่มเรียนที่ฉันเพิ่ม</h3>
                  <p
                    v-for="proposal in myProposals.filter((item) => item.courseId === selected!.id)"
                    :key="proposal.id"
                    class="mb-1"
                  >
                    กลุ่ม {{ proposal.section }} · {{ proposal.semester }}/{{
                      proposal.academicYear
                    }}
                    <span class="text-muted">{{
                      proposal.status === "pending"
                        ? "กำลังตรวจสอบ"
                        : proposal.status === "approved"
                        ? "เพิ่มแล้ว"
                        : "ไม่อนุมัติ"
                    }}</span>
                  </p>
                </div>
              </div>
              <div class="row g-2 mb-3">
                <div class="col-sm-4">
                  <select
                    v-model.number="reviewRatingFilter"
                    class="form-select"
                    aria-label="กรองคะแนน"
                    @change="loadReviews()"
                  >
                    <option :value="0">ทุกคะแนน</option>
                    <option v-for="score in 5" :key="score" :value="score">
                      {{ score }} ดาว
                    </option>
                  </select>
                </div>
                <div class="col-sm-4">
                  <select
                    v-model="reviewSemesterFilter"
                    class="form-select"
                    aria-label="กรองภาคการศึกษา"
                    @change="loadReviews()"
                  >
                    <option value="">ทุกเทอม</option>
                    <option value="1">เทอม 1</option>
                    <option value="2">เทอม 2</option>
                    <option value="ฤดูร้อน">ฤดูร้อน</option>
                  </select>
                </div>
                <div class="col-sm-4">
                  <select
                    v-model.number="reviewYearFilter"
                    class="form-select"
                    aria-label="กรองปีการศึกษา"
                    @change="loadReviews()"
                  >
                    <option :value="0">ทุกปี</option>
                    <option
                      v-for="year in [2569, 2568, 2567, 2566, 2565]"
                      :key="year"
                      :value="year"
                    >
                      {{ year }}
                    </option>
                  </select>
                </div>
              </div>
              <p v-if="!reviews.length" class="review-empty">ยังไม่มีรีวิว</p>
              <article
                v-for="review in reviews"
                :key="review.id"
                class="review-box review-card"
              >
                <div
                  class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3"
                >
                  <div class="d-flex align-items-center gap-2">
                    <StarRating class="stars" :value="review.rating" :label="`ให้คะแนน ${review.rating} จาก 5 ดาว`" />
                    <span
                      v-if="review.semester && review.academicYear"
                      class="offering-term"
                      >เทอม {{ review.semester }}/{{ review.academicYear }}</span
                    >
                  </div>
                  <span v-if="reviewDate(review.createdAt)" class="text-muted small"
                    ><i class="bi bi-clock me-1"></i
                    >{{ reviewDate(review.createdAt) }}</span
                  >
                </div>
                <div v-if="review.section" class="review-schedule sec-info-box">
                  <div class="review-schedule-top">
                    <div>
                      <span class="text-muted fw-semibold"
                        >กลุ่ม {{ review.section }}</span
                      ><span v-if="review.instructorName" class="fw-bold ms-2 text-dark"
                        ><i class="bi bi-person-video3 me-1"></i
                        >{{ review.instructorName }}</span
                      >
                    </div>
                    <button
                      v-if="
                        (reviewOffering(review) || hasReportedTime(review)) &&
                        !isReviewSelected(review)
                      "
                      class="btn btn-sm btn-success"
                      @click="addReviewToTimetable(review)"
                    >
                      <i class="bi bi-pin-angle-fill me-1"></i>เพิ่มลงตาราง</button
                    ><span
                      v-else-if="isReviewSelected(review)"
                      class="badge selected-badge"
                      ><i class="bi bi-check-circle-fill me-1"></i>อยู่ในตารางแล้ว</span
                    >
                  </div>
                  <p
                    v-if="review.dayOfWeek && review.startsAt && review.endsAt"
                    class="mb-1 text-muted schedule-line"
                  >
                    <i class="bi bi-calendar-event me-1"></i>วัน{{
                      dayNames[review.dayOfWeek]
                    }}
                    | ⏰ {{ timeValue(review.startsAt) }} -
                    {{ timeValue(review.endsAt) }} น.
                  </p>
                  <p v-if="reviewOffering(review)" class="small text-muted mb-1">
                    ข้อมูลกลุ่มเรียนที่อนุมัติ ·
                    {{ offeringMeetings[reviewOffering(review)!.id].map((meeting) => `${dayNames[meeting.day]} ${meeting.start}–${meeting.end}`).join(' · ')
                    }}<span v-if="reviewOffering(review)!.instructor_name">
                      · {{ reviewOffering(review)!.instructor_name }}</span
                    >
                  </p>
                  <p v-else-if="!hasReportedTime(review)" class="small text-muted mb-1">
                    รีวิวนี้ไม่มีข้อมูลเวลาเรียนที่ใช้เพิ่มลงตารางได้
                  </p>
                </div>
                <p class="mt-3 mb-0">{{ review.text }}</p>
              </article>
            </div>
          </div>
        </section>
      </template>
    </section>
    <button
      v-if="catalogActive && !selected && showBackToTop"
      class="btn btn-outline-purple back-to-top-btn"
      type="button"
      aria-label="กลับขึ้นด้านบน"
      @click="scrollToTop"
    >
      <i class="bi bi-arrow-up" aria-hidden="true"></i>
    </button>
    <button
      v-if="signedIn && !dashboard"
      class="btn btn-purple floating-contact-btn"
      aria-label="แจ้งปัญหา/ติดต่อ"
      :aria-expanded="contactOpen"
      @click="contactOpen = !contactOpen"
    >
      <i class="bi bi-chat-heart-fill fs-5"></i
      ><span class="contact-button-label ms-1">แจ้งปัญหา/ติดต่อ</span>
    </button>
    <div
      v-if="signedIn && contactOpen"
      class="contact-panel"
      role="dialog"
      aria-modal="true"
      aria-label="ติดต่อผู้ดูแล"
    >
      <div class="contact-modal-card">
        <div class="contact-modal-header">
          <h5 class="modal-title text-purple mb-0">
            <i class="bi bi-headset me-2"></i>ติดต่อผู้ดูแล
          </h5>
          <button
            class="btn-close"
            aria-label="ปิด"
            @click="contactOpen = false"
          ></button>
        </div>
        <div class="contact-modal-body">
          <a
            href="https://line.me/R/ti/p/@293shldn"
            target="_blank"
            rel="noopener noreferrer"
            class="btn contact-line text-white fw-bold w-100 mb-3"
            ><i class="bi bi-line fs-5 me-2"></i>ติดต่อทาง LINE</a
          ><a
            href="https://www.instagram.com/varasarn_official"
            target="_blank"
            rel="noopener noreferrer"
            class="btn contact-instagram text-white fw-bold w-100"
            ><i class="bi bi-instagram fs-5 me-2"></i>ทักแชททาง IG</a
          >
        </div>
      </div>
    </div>
    <div
      v-if="courseModalOpen"
      class="contact-panel"
      role="dialog"
      aria-modal="true"
      aria-label="เพิ่มรายวิชาใหม่"
      @click.self="courseModalOpen = false"
    >
      <div class="contact-modal-card">
        <div class="contact-modal-header">
          <h5 class="modal-title text-purple mb-0">เพิ่มรายวิชาใหม่</h5>
          <button
            class="btn-close"
            aria-label="ปิด"
            @click="courseModalOpen = false"
          ></button>
        </div>
        <div class="course-modal-body">
          <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
          <div class="mb-3">
            <label for="new-course-code">รหัสวิชา</label
            ><input id="new-course-code" v-model="courseCode" class="form-control" />
          </div>
          <div class="mb-3">
            <label for="new-course-name">ชื่อวิชา</label
            ><input id="new-course-name" v-model="courseName" class="form-control" />
          </div>
          <div class="mb-4">
            <label for="new-course-category">หมวดหมู่</label
            ><select
              id="new-course-category"
              v-model="courseCategoryId"
              class="form-select"
            >
              <option
                v-for="category in categories"
                :key="category.id"
                :value="category.id"
              >
                {{ category.name }}
              </option>
            </select>
          </div>
          <button class="btn btn-purple w-100 py-2" @click="submitCourseModal">
            <i class="bi bi-save me-1"></i>บันทึก
          </button>
        </div>
      </div>
    </div>
    <div
      v-if="confirmDialog"
      class="confirm-overlay"
      role="alertdialog"
      aria-modal="true"
      @click.self="resolveConfirm(false)"
    >
      <div class="confirm-card">
        <i
          class="bi confirm-icon"
          :class="
            confirmDialog.variant === 'success'
              ? 'bi-check-circle-fill text-success'
              : 'bi-exclamation-triangle-fill text-warning'
          "
        ></i>
        <p class="confirm-message">{{ confirmDialog.message }}</p>
        <div class="confirm-actions">
          <button
            class="btn btn-outline-secondary confirm-cancel"
            @click="resolveConfirm(false)"
          >
            {{ confirmDialog.cancelLabel }}</button
          ><button class="btn btn-purple confirm-accept" @click="resolveConfirm(true)">
            {{ confirmDialog.confirmLabel }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="toastMessage" class="toast-banner" role="status" aria-live="polite">
      <i class="bi bi-check-circle-fill me-2"></i>{{ toastMessage }}
    </div>
  </main>
</template>
