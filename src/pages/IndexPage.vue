<template>
  <q-page class="transportklok-page column items-center">
    <section class="hero-section">
      <div class="hero-card">
        <div class="row items-start justify-between q-col-gutter-md">
          <div class="col">
            <div class="text-overline text-uppercase text-weight-bold text-white">Transportklok Tacho</div>
            <div class="text-h5 text-white q-mt-xs">Authenticatiehub voor tachograafkaarten</div>
            <div class="text-body2 text-white q-mt-sm">
              Koppel je tachograaf bedrijfskaarten automatisch met TransportKlok en TrackMijn.
            </div>
            <div class="text-caption text-white q-mt-md">
              Server: {{ flespiHost || 'wacht op configuratie' }}
            </div>
          </div>
          <div class="col-auto column items-end q-gutter-xs">
            <q-chip :color="authState === 'ready' ? 'green' : 'orange'" text-color="white" icon="mdi-shield-check">
              {{ authState === 'ready' ? 'Geauthenticeerd' : 'Authenticatie vereist' }}
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
            <div class="text-subtitle1 text-weight-bold">TransportKlok-sessie</div>
            <div class="text-caption text-grey-7">{{ statusMessage }}</div>
          </div>
          <div class="row items-center q-gutter-sm">
            <q-btn
              v-if="authState !== 'ready'"
              color="primary"
              unelevated
              :loading="isRequestingLogin || isCheckingLogin"
              icon="mdi-login"
              label="Inloggen met TransportKlok"
              @click="startLogin"
            />
            <q-btn
              v-else
              color="secondary"
              flat
              icon="mdi-refresh"
              :loading="isCheckingLogin"
              label="Opnieuw controleren"
              @click="refreshSession"
            />
          </div>
        </q-card-section>
        <q-separator />
        <q-card-section>
          <div class="row q-col-gutter-md">
            <div class="col-12 col-md-6">
              <div class="text-body1 text-weight-medium">Authenticatiestappen</div>
              <ol class="text-body2 text-grey-8 q-mt-sm">
                <li>Start de TransportKlok-login vanaf dit apparaat.</li>
                <li>Rond het inloggen af in de geopende browser.</li>
                <li>Keer terug naar de app; wij controleren en maken automatisch de apparaat- en sessietokens aan.</li>
              </ol>
              <div class="text-caption text-positive q-mt-sm" v-if="pendingToken">
                Wachten op bevestiging van token <strong>{{ pendingToken }}</strong>...
              </div>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-body1 text-weight-medium">TrackMijn-verbinding</div>
              <div class="text-body2 text-grey-8 q-mt-sm">
                Na het inloggen genereren we een TrackMijn API-token en controleren we of je tachograafbridgeclient bestaat,
                zodat de Flespi-configuratie synchroon blijft.
              </div>
              <div class="text-caption q-mt-sm">
                Bedrijfs-ID: <strong>{{ trackmijnCompanyId || 'niet beschikbaar' }}</strong><br />
                Bridge-identificatie: <strong>{{ trackmijnClientIdentifier }}</strong>
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

const authState = ref<'loading' | 'needs-login' | 'ready'>('loading')
const statusMessage = ref('TransportKlok-sessie wordt gecontroleerd...')
const user = ref<TransportklokUser | null>(null)
const pendingToken = ref<string>('')
const pollInterval = ref<number | undefined>(undefined)
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
}

onMounted(async () => {
  await transportklokService.applyFlespiServerConfig()
  await refreshSession()
})

onBeforeUnmount(() => {
  clearPoll()
})

async function refreshSession() {
  isCheckingLogin.value = true
  statusMessage.value = 'Opgeslagen TransportKlok-sessie wordt gevalideerd...'

  try {
    const currentUser = await transportklokService.ensureSession()
    user.value = currentUser
    await transportklokService.ensureTrackmijnSetup()
    statusMessage.value = 'Geauthenticeerd bij TransportKlok en TrackMijn.'
    authState.value = 'ready'
  } catch (error) {
    authState.value = 'needs-login'
    if (error instanceof RoleNotAllowedError) {
      Notify.create({
        message: 'Dit accounttype mag de tachograafbrug niet gebruiken.',
        color: 'negative',
        position: 'bottom',
      })
      statusMessage.value = error.message
      transportklokService.clearAuth()
    } else {
      statusMessage.value = (error as Error).message || 'Meld je aan bij TransportKlok.'
    }
  } finally {
    isCheckingLogin.value = false
  }
}

async function startLogin() {
  isRequestingLogin.value = true
  statusMessage.value = 'TransportKlok-authenticatietoken wordt aangevraagd...'
  clearPoll()

  try {
    const response = await transportklokService.requestDeviceAuthentication()
    pendingToken.value = response.token
    window.open(response.url, '_blank')
    statusMessage.value = 'Voltooi de aanmelding in je browser; wij controleren dit automatisch.'
    beginPolling()
  } catch (error) {
    statusMessage.value = (error as Error).message || 'Kan de aanmelding niet starten.'
  } finally {
    isRequestingLogin.value = false
  }
}

function beginPolling() {
  clearPoll()
  pollInterval.value = window.setInterval(() => {
    void checkLoginStatus()
  }, 3000)
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
    statusMessage.value = (error as Error).message || 'Verificatie van de aanmelding is mislukt.'
  }
}

async function finalizeLogin() {
  statusMessage.value = 'Apparaatregistratie wordt voltooid...'
  try {
    const currentUser = await transportklokService.completeDeviceLogin(pendingToken.value)
    user.value = currentUser
    await transportklokService.ensureTrackmijnSetup()
    statusMessage.value = 'Geauthenticeerd bij TransportKlok en TrackMijn.'
    authState.value = 'ready'
  } catch (error) {
    if (error instanceof RoleNotAllowedError) {
      Notify.create({
        message: 'Dit accounttype mag de tachograafbrug niet gebruiken.',
        color: 'negative',
        position: 'bottom',
      })
    }
    statusMessage.value = (error as Error).message || 'Authenticatie is mislukt.'
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
