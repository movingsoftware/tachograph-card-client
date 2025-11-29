<template>
  <q-page class="transportklok-page column items-center">
    <section class="hero-section">
      <div class="hero-card">
        <div class="row items-start justify-between q-col-gutter-md">
          <div class="col">
            <div class="text-overline text-uppercase text-weight-bold text-white">Transportklok Tacho</div>
            <div class="text-h5 text-white q-mt-xs">Tachograph card authentication hub</div>
            <div class="text-body2 text-white q-mt-sm">
              Connect your tachograph company cards to TransportKlok and TrackMijn automatically.
            </div>
            <div class="text-caption text-white q-mt-md">
              Server: {{ flespiHost || 'waiting for configuration' }}
            </div>
          </div>
          <div class="col-auto column items-end q-gutter-xs">
            <q-chip :color="authState === 'ready' ? 'green' : 'orange'" text-color="white" icon="mdi-shield-check">
              {{ authState === 'ready' ? 'Authenticated' : 'Authentication required' }}
            </q-chip>
            <q-chip v-if="organizationName" outline color="white" text-color="white" icon="business">
              {{ organizationName }}
            </q-chip>
            <q-chip v-if="userDisplayName" outline color="white" text-color="white" icon="person">
              {{ userDisplayName }}
            </q-chip>
          </div>
        </div>
      </div>
    </section>

    <section class="content-section">
      <q-card class="status-card" flat bordered>
        <q-card-section class="row items-center justify-between">
          <div>
            <div class="text-subtitle1 text-weight-bold">TransportKlok session</div>
            <div class="text-caption text-grey-7">{{ statusMessage }}</div>
          </div>
          <div class="row items-center q-gutter-sm">
            <q-btn
              v-if="authState !== 'ready'"
              color="primary"
              unelevated
              :loading="isRequestingLogin || isCheckingLogin"
              icon="mdi-login"
              label="Sign in with TransportKlok"
              @click="startLogin"
            />
            <q-btn
              v-else
              color="secondary"
              flat
              icon="mdi-refresh"
              :loading="isCheckingLogin"
              label="Re-check"
              @click="refreshSession"
            />
          </div>
        </q-card-section>
        <q-separator />
        <q-card-section>
          <div class="row q-col-gutter-md">
            <div class="col-12 col-md-6">
              <div class="text-body1 text-weight-medium">Authentication steps</div>
              <ol class="text-body2 text-grey-8 q-mt-sm">
                <li>Launch the TransportKlok login from this device.</li>
                <li>Finish signing in using the browser that opens.</li>
                <li>Return to the app; we will verify and create the device and session tokens automatically.</li>
              </ol>
              <div class="text-caption text-positive q-mt-sm" v-if="pendingToken">
                Waiting for confirmation of token <strong>{{ pendingToken }}</strong>...
              </div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-body1 text-weight-medium">TrackMijn connection</div>
              <div class="text-body2 text-grey-8 q-mt-sm">
                Once logged in, we generate a TrackMijn API token and ensure your tachograph bridge client exists so the
                Flespi setup stays in sync.
              </div>
              <div class="text-caption q-mt-sm">
                Company ID: <strong>{{ trackmijnCompanyId || 'not available' }}</strong><br />
                Bridge identifier: <strong>{{ trackmijnClientIdentifier }}</strong>
              </div>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <div v-if="authState === 'ready'" class="q-mt-md full-width flex justify-center">
        <TachoMainComponent />
      </div>

      <div v-else class="q-mt-xl text-grey-7 text-center">
        <q-spinner color="primary" size="32px" v-if="isCheckingLogin || authState === 'loading'" />
        <div class="q-mt-sm">{{ statusMessage }}</div>
      </div>
    </section>
  </q-page>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed } from 'vue'
import { Notify } from 'quasar'
import TachoMainComponent from '../components/TachoMainComponent.vue'
import { RoleNotAllowedError, transportklokService, type TransportklokUser } from '../services/transportklok'

const POLL_INTERVAL_MS = 5000
const MAX_POLL_DURATION_MS = 5 * 60 * 1000

const authState = ref<'loading' | 'needs-login' | 'ready'>('loading')
const statusMessage = ref('Checking TransportKlok session...')
const user = ref<TransportklokUser | null>(null)
const pendingToken = ref<string>('')
const pollInterval = ref<number | undefined>(undefined)
const pollStartedAt = ref<number | null>(null)
const isRequestingLogin = ref(false)
const isCheckingLogin = ref(false)

const userDisplayName = computed(() => {
  if (!user.value) return ''
  const composed = `${user.value.first_name ?? ''} ${user.value.last_name ?? ''}`.trim()
  return composed || user.value.email || ''
})
const organizationName = computed(() => user.value?.currentOrganization?.name ?? '')
const trackmijnCompanyId = computed(() => transportklokService.getTrackmijnInfo().companyId || '')
const trackmijnClientIdentifier = computed(() => transportklokService.getTrackmijnInfo().clientIdentifier || '')
const flespiHost = computed(() => transportklokService.getFlespiHost())

const clearPoll = () => {
  if (pollInterval.value) {
    window.clearInterval(pollInterval.value)
    pollInterval.value = undefined
  }
  pollStartedAt.value = null
}

onMounted(async () => {
  window.addEventListener('focus', handleFocus)
  window.addEventListener('blur', handleBlur)
  await transportklokService.applyFlespiServerConfig()
  await refreshSession()
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', handleFocus)
  window.removeEventListener('blur', handleBlur)
  clearPoll()
})

function handleFocus() {
  if (pendingToken.value && !pollInterval.value) {
    beginPolling()
  }
}

function handleBlur() {
  clearPoll()
}

async function refreshSession() {
  isCheckingLogin.value = true
  statusMessage.value = 'Validating stored TransportKlok session...'

  try {
    const currentUser = await transportklokService.ensureSession()
    user.value = currentUser
    await transportklokService.ensureTrackmijnSetup()
    statusMessage.value = 'Authenticated with TransportKlok and TrackMijn.'
    authState.value = 'ready'
  } catch (error) {
    authState.value = 'needs-login'
    if (error instanceof RoleNotAllowedError) {
      Notify.create({
        message: 'This account type is not allowed to use the tachograph bridge.',
        color: 'negative',
        position: 'bottom',
      })
      statusMessage.value = error.message
      transportklokService.clearAuth()
    } else {
      statusMessage.value = (error as Error).message || 'Please sign in to TransportKlok.'
    }
  } finally {
    isCheckingLogin.value = false
  }
}

async function startLogin() {
  isRequestingLogin.value = true
  statusMessage.value = 'Requesting TransportKlok authentication token...'
  clearPoll()

  try {
    const response = await transportklokService.requestDeviceAuthentication()
    pendingToken.value = response.token
    window.open(response.url, '_blank')
    statusMessage.value = 'Complete the login in your browser, we will verify automatically.'
    beginPolling()
  } catch (error) {
    statusMessage.value = (error as Error).message || 'Unable to start login.'
  } finally {
    isRequestingLogin.value = false
  }
}

function beginPolling() {
  clearPoll()
  pollStartedAt.value = Date.now()
  pollInterval.value = window.setInterval(() => {
    if (!pendingToken.value) {
      clearPoll()
      return
    }

    if (pollStartedAt.value && Date.now() - pollStartedAt.value >= MAX_POLL_DURATION_MS) {
      statusMessage.value = 'Login verification timed out. Please start again.'
      clearPoll()
      return
    }

    void checkLoginStatus()
  }, POLL_INTERVAL_MS)
}

async function checkLoginStatus() {
  if (!pendingToken.value) return
  try {
    const isReady = await transportklokService.checkAuthenticationToken(pendingToken.value)
    if (isReady) {
      clearPoll()
      await finalizeLogin()
    }
  } catch (error) {
    clearPoll()
    statusMessage.value = (error as Error).message || 'Login verification failed.'
  }
}

async function finalizeLogin() {
  statusMessage.value = 'Completing device registration...'
  try {
    const currentUser = await transportklokService.completeDeviceLogin(pendingToken.value)
    user.value = currentUser
    await transportklokService.ensureTrackmijnSetup()
    statusMessage.value = 'Authenticated with TransportKlok and TrackMijn.'
    authState.value = 'ready'
  } catch (error) {
    if (error instanceof RoleNotAllowedError) {
      Notify.create({
        message: 'This account type is not allowed to use the tachograph bridge.',
        color: 'negative',
        position: 'bottom',
      })
    }
    statusMessage.value = (error as Error).message || 'Authentication failed.'
    authState.value = 'needs-login'
  } finally {
    pendingToken.value = ''
    clearPoll()
  }
}
</script>

<style scoped>
.transportklok-page {
  padding: 24px;
  background: radial-gradient(circle at 20% 20%, rgba(255, 121, 0, 0.2), transparent 45%),
    radial-gradient(circle at 80% 0%, rgba(0, 117, 197, 0.2), transparent 35%),
    #f5f7fb;
}

.hero-section {
  width: 100%;
}

.hero-card {
  background: linear-gradient(135deg, #ff8c32, #005ea5);
  border-radius: 18px;
  padding: 20px;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.12);
}

.content-section {
  width: 100%;
  max-width: 1100px;
  margin-top: 18px;
}

.status-card {
  width: 100%;
}
</style>
