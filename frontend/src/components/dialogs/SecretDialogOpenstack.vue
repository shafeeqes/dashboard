<!--
SPDX-FileCopyrightText: 2021 SAP SE or an SAP affiliate company and Gardener contributors

SPDX-License-Identifier: Apache-2.0
 -->

<template>
  <secret-dialog
    :value=value
    :data="secretData"
    :data-valid="valid"
    :secret="secret"
    :vendor="vendor"
    :create-title="`Add new ${name} Secret`"
    :replace-title="`Replace ${name} Secret`"
    @input="onInput">

    <template v-slot:secret-slot>
      <div v-if="vendor==='openstack-designate'">
        <v-text-field
          color="primary"
          v-model="authURL"
          label="Auth URL"
          :error-messages="getErrorMessages('authURL')"
          @input="$v.authURL.$touch()"
          @blur="$v.authURL.$touch()"
        ></v-text-field>
      </div>
      <div>
        <v-text-field
          color="primary"
          v-model="domainName"
          ref="domainName"
          label="Domain Name"
          :error-messages="getErrorMessages('domainName')"
          @input="$v.domainName.$touch()"
          @blur="$v.domainName.$touch()"
        ></v-text-field>
      </div>
      <div>
        <v-text-field
          color="primary"
          v-model="tenantName"
          label="Project / Tenant Name"
          :error-messages="getErrorMessages('tenantName')"
          @input="$v.tenantName.$touch()"
          @blur="$v.tenantName.$touch()"
        ></v-text-field>
      </div>
      <div>
        <hint-colorizer hint-color="primary">
          <v-text-field
          color="primary"
          v-model="username"
          label="Technical User"
          :error-messages="getErrorMessages('username')"
          @input="$v.username.$touch()"
          @blur="$v.username.$touch()"
          hint="Do not use personalized login credentials. Instead, use credentials of a technical user"
          ></v-text-field>
        </hint-colorizer>
      </div>
      <div>
        <hint-colorizer hint-color="warning">
          <v-text-field
            color="primary"
            v-model="password"
            label="Password"
            :error-messages="getErrorMessages('password')"
            :append-icon="hideSecret ? 'mdi-eye' : 'mdi-eye-off'"
            :type="hideSecret ? 'password' : 'text'"
            @click:append="() => (hideSecret = !hideSecret)"
            @input="$v.password.$touch()"
            @blur="$v.password.$touch()"
            hint="Do not use personalized login credentials. Instead, use credentials of a technical user"
          ></v-text-field>
        </hint-colorizer>
      </div>
    </template>

    <template v-slot:help-slot>
      <div v-if="vendor==='openstack'">
        <p>
          Before you can provision and access a Kubernetes cluster on OpenStack, you need to add account credentials.
          The Gardener needs the credentials to provision and operate the OpenStack infrastructure for your Kubernetes cluster.
        </p>
        <p>
          Ensure that the user has privileges to <strong>create, modify and delete VMs</strong>.
        </p>
      </div>
      <div v-if="vendor==='openstack-designate'">
        <p>Make sure that you configure your account for DNS usage.</p>
        <p>Required Roles: dns_viewer, dns_webmaster</p>
      </div>
      <p>
        Read the
        <external-link url="https://docs.openstack.org/horizon/latest/admin/admin-manage-roles.html">OpenStack help section</external-link> on how to create and manage roles.
      </p>
    </template>

  </secret-dialog>

</template>

<script>
import { mapGetters } from 'vuex'
import SecretDialog from '@/components/dialogs/SecretDialog'
import { required, requiredIf } from 'vuelidate/lib/validators'
import { getValidationErrors, setDelayedInputFocus } from '@/utils'
import HintColorizer from '@/components/HintColorizer'
import ExternalLink from '@/components/ExternalLink'

const validationErrors = {
  domainName: {
    required: 'You can\'t leave this empty.'
  },
  tenantName: {
    required: 'You can\'t leave this empty.'
  },
  username: {
    required: 'You can\'t leave this empty.'
  },
  password: {
    required: 'You can\'t leave this empty.'
  },
  authURL: {
    required: 'Required for Secret Type DNS.'
  }
}

export default {
  components: {
    SecretDialog,
    HintColorizer,
    ExternalLink
  },
  props: {
    value: {
      type: Boolean,
      required: true
    },
    secret: {
      type: Object
    },
    vendor: {
      type: String
    }
  },
  data () {
    return {
      domainName: undefined,
      tenantName: undefined,
      username: undefined,
      password: undefined,
      hideSecret: true,
      authURL: undefined,
      validationErrors
    }
  },
  validations () {
    // had to move the code to a computed property so that the getValidationErrors method can access it
    return this.validators
  },
  computed: {
    ...mapGetters([
      'cloudProfileByName'
    ]),
    valid () {
      return !this.$v.$invalid
    },
    secretData () {
      const data = {
        domainName: this.domainName,
        tenantName: this.tenantName,
        username: this.username,
        password: this.password
      }
      if (this.authURL && this.authURL.length) {
        data.OS_AUTH_URL = this.authURL
      }
      return data
    },
    validators () {
      const validators = {
        domainName: {
          required
        },
        tenantName: {
          required
        },
        username: {
          required
        },
        password: {
          required
        },
        authURL: {
          required: requiredIf(function () {
            return this.vendor === 'openstack-designate'
          })
        }
      }
      return validators
    },
    isCreateMode () {
      return !this.secret
    },
    name () {
      if (this.vendor === 'openstack') {
        return 'OpenStack'
      }
      if (this.vendor === 'openstack-designate') {
        return 'OpenStack Designate'
      }
      return undefined
    }
  },
  methods: {
    onInput (value) {
      this.$emit('input', value)
    },
    reset () {
      this.$v.$reset()

      this.domainName = ''
      this.tenantName = ''
      this.username = ''
      this.password = ''
      this.authURL = ''

      if (!this.isCreateMode) {
        if (this.secret.data) {
          this.domainName = this.secret.data.domainName
          this.tenantName = this.secret.data.tenantName
        }
        setDelayedInputFocus(this, 'domainName')
      }
    },
    getErrorMessages (field) {
      return getValidationErrors(this, field)
    }
  },
  watch: {
    value: function (value) {
      if (value) {
        this.reset()
      }
    }
  }
}
</script>
