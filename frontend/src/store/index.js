//
// SPDX-FileCopyrightText: 2021 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import Vue from 'vue'
import Vuex from 'vuex'
import createLogger from 'vuex/dist/logger'

import {
  gravatarUrlGeneric,
  displayName,
  fullDisplayName,
  getDateFormatted,
  canI,
  TargetEnum,
  isHtmlColorCode,
  parseSize,
  isOwnSecret,
  shortRandomString,
  isValidTerminationDate,
  selectedImageIsNotLatest,
  availableKubernetesUpdatesCache,
  defaultCriNameByKubernetesVersion,
  UNKNOWN_EXPIRED_TIMESTAMP
} from '@/utils'
import { v4 as uuidv4 } from '@/utils/uuid'
import { hash } from '@/utils/crypto'
import {
  getSubjectRules,
  getKubeconfigData,
  listProjectTerminalShortcuts
} from '@/utils/api'
import map from 'lodash/map'
import mapKeys from 'lodash/mapKeys'
import mapValues from 'lodash/mapValues'
import flatMap from 'lodash/flatMap'
import filter from 'lodash/filter'
import isObject from 'lodash/isObject'
import uniq from 'lodash/uniq'
import uniqBy from 'lodash/uniqBy'
import get from 'lodash/get'
import includes from 'lodash/includes'
import isEmpty from 'lodash/isEmpty'
import some from 'lodash/some'
import camelCase from 'lodash/camelCase'
import compact from 'lodash/compact'
import merge from 'lodash/merge'
import difference from 'lodash/difference'
import forEach from 'lodash/forEach'
import intersection from 'lodash/intersection'
import find from 'lodash/find'
import head from 'lodash/head'
import pickBy from 'lodash/pickBy'
import sortBy from 'lodash/sortBy'
import lowerCase from 'lodash/lowerCase'
import cloneDeep from 'lodash/cloneDeep'
import max from 'lodash/max'
import template from 'lodash/template'
import toPairs from 'lodash/toPairs'
import fromPairs from 'lodash/fromPairs'
import isEqual from 'lodash/isEqual'
import forOwn from 'lodash/forOwn'
import replace from 'lodash/replace'
import sample from 'lodash/sample'
import split from 'lodash/split'
import pick from 'lodash/pick'

import moment from '@/utils/moment'
import { createIoPlugin } from '@/utils/Emitter'
import createMediaPlugin from './plugins/mediaPlugin'
import shoots from './modules/shoots'
import cloudProfiles from './modules/cloudProfiles'
import gardenerExtensions from './modules/gardenerExtensions'
import seeds from './modules/seeds'
import projects from './modules/projects'
import draggable from './modules/draggable'
import members from './modules/members'
import cloudProviderSecrets from './modules/cloudProviderSecrets'
import tickets from './modules/tickets'
import shootStaging from './modules/shootStaging'
import semver from 'semver'
import colors from 'vuetify/lib/util/colors'

const localStorage = Vue.localStorage

Vue.use(Vuex)

const strict = process.env.NODE_ENV !== 'production'
const debug = includes(split(process.env.VUE_APP_DEBUG, ','), 'vuex')

// plugins
const plugins = [
  createIoPlugin(Vue.auth),
  createMediaPlugin(window)
]
if (debug) {
  plugins.push(createLogger())
}

// initial state
const state = {
  cfg: null,
  kubeconfigData: null,
  ready: false,
  namespace: null,
  subjectRules: { // selfSubjectRules for state.namespace
    resourceRules: null,
    nonResourceRules: null,
    incomplete: false,
    evaluationError: null
  },
  sidebar: true,
  user: null,
  redirectPath: null,
  loading: false,
  alert: null,
  shootsLoading: false,
  websocketConnectionError: null,
  location: moment.tz.guess(),
  timezone: moment().format('Z'),
  focusedElementId: null,
  splitpaneResize: null,
  splitpaneLayouts: {},
  projectTerminalShortcuts: null,
  conditionCache: {
    APIServerAvailable: {
      displayName: 'API Server',
      shortName: 'API',
      description: 'Indicates whether the shoot\'s kube-apiserver is healthy and available. If this is in error state then no interaction with the cluster is possible. The workload running on the cluster is most likely not affected.'
    },
    ControlPlaneHealthy: {
      displayName: 'Control Plane',
      shortName: 'CP',
      description: 'Indicates whether all control plane components are up and running.',
      showAdminOnly: true
    },
    EveryNodeReady: {
      displayName: 'Nodes',
      shortName: 'N',
      description: 'Indicates whether all nodes registered to the cluster are healthy and up-to-date. If this is in error state there then there is probably an issue with the cluster nodes. In worst case there is currently not enough capacity to schedule all the workloads/pods running in the cluster and that might cause a service disruption of your applications.'
    },
    SystemComponentsHealthy: {
      displayName: 'System Components',
      shortName: 'SC',
      description: 'Indicates whether all system components in the kube-system namespace are up and running. Gardener manages these system components and should automatically take care that the components become healthy again.'
    }
  },
  darkTheme: false,
  colorScheme: 'auto',
  subscriptions: {},
  gardenctlOptions: {
    legacyCommands: false,
    shell: null
  }
}
class Shortcut {
  constructor (shortcut, unverified = true) {
    Object.assign(this, shortcut)
    Object.defineProperty(this, 'id', {
      value: hash(shortcut)
    })
    Object.defineProperty(this, 'unverified', {
      value: unverified
    })
  }
}

function getFilterValue (state, getters) {
  if (state.namespace === '_all' && getters.onlyShootsWithIssues) {
    return 'issues'
  }
  return null
}

const vendorNameFromImageName = imageName => {
  const lowerCaseName = lowerCase(imageName)
  if (lowerCaseName.includes('coreos')) {
    return 'coreos'
  } else if (lowerCaseName.includes('ubuntu')) {
    return 'ubuntu'
  } else if (lowerCaseName.includes('gardenlinux')) {
    return 'gardenlinux'
  } else if (lowerCaseName.includes('suse') && lowerCaseName.includes('jeos')) {
    return 'suse-jeos'
  } else if (lowerCaseName.includes('suse') && lowerCaseName.includes('chost')) {
    return 'suse-chost'
  } else if (lowerCaseName.includes('flatcar')) {
    return 'flatcar'
  } else if (lowerCaseName.includes('memoryone') || lowerCaseName.includes('vsmp')) {
    return 'memoryone'
  } else if (lowerCaseName.includes('aws-route53')) {
    return 'aws-route53'
  } else if (lowerCaseName.includes('azure-dns')) {
    return 'azure-dns'
  } else if (lowerCaseName.includes('google-clouddns')) {
    return 'google-clouddns'
  } else if (lowerCaseName.includes('openstack-designate')) {
    return 'openstack-designate'
  } else if (lowerCaseName.includes('alicloud-dns')) {
    return 'alicloud-dns'
  } else if (lowerCaseName.includes('cloudflare-dns')) {
    return 'cloudflare-dns'
  } else if (lowerCaseName.includes('infoblox-dns')) {
    return 'infoblox-dns'
  } else if (lowerCaseName.includes('netlify-dns')) {
    return 'netlify-dns'
  }
  return undefined
}

const findVendorHint = (vendorHints, vendorName) => {
  return find(vendorHints, hint => includes(hint.matchNames, vendorName))
}

const matchesPropertyOrEmpty = (path, srcValue) => {
  return object => {
    const objValue = get(object, path)
    if (!objValue) {
      return true
    }
    return isEqual(objValue, srcValue)
  }
}

const isValidRegion = (getters, cloudProfileName, cloudProviderKind) => {
  return region => {
    if (cloudProviderKind === 'azure') {
      // Azure regions may not be zoned, need to filter these out for the dashboard
      return !!getters.zonesByCloudProfileNameAndRegion({ cloudProfileName, region }).length
    }

    // Filter regions that are not defined in cloud profile
    const cloudProfile = getters.cloudProfileByName(cloudProfileName)
    if (cloudProfile) {
      return some(cloudProfile.data.regions, ['name', region])
    }

    return true
  }
}

function mapOptionForInput (optionValue, shootResource) {
  const key = get(optionValue, 'key')
  if (!key) {
    return
  }

  const isSelectedByDefault = false
  const inputInverted = get(optionValue, 'input.inverted', false)
  const defaultValue = inputInverted ? !isSelectedByDefault : isSelectedByDefault
  const rawValue = get(shootResource, ['metadata', 'annotations', key], `${defaultValue}`) === 'true'
  const value = inputInverted ? !rawValue : rawValue

  const option = {
    value
  }
  return [key, option]
}

function mapAccessRestrictionForInput (accessRestrictionDefinition, shootResource) {
  const key = get(accessRestrictionDefinition, 'key')
  if (!key) {
    return
  }

  const isSelectedByDefault = false
  const inputInverted = get(accessRestrictionDefinition, 'input.inverted', false)
  const defaultValue = inputInverted ? !isSelectedByDefault : isSelectedByDefault
  const rawValue = get(shootResource, ['spec', 'seedSelector', 'matchLabels', key], `${defaultValue}`) === 'true'
  const value = inputInverted ? !rawValue : rawValue

  let optionsPair = map(get(accessRestrictionDefinition, 'options'), option => mapOptionForInput(option, shootResource))
  optionsPair = compact(optionsPair)
  const options = fromPairs(optionsPair)

  const accessRestriction = {
    value,
    options
  }
  return [key, accessRestriction]
}

function mapOptionForDisplay ({ optionDefinition, option: { value } }) {
  const {
    key,
    display: {
      visibleIf = false,
      title = key,
      description
    }
  } = optionDefinition

  const optionVisible = visibleIf === value
  if (!optionVisible) {
    return undefined // skip
  }

  return {
    key,
    title,
    description
  }
}

function mapAccessRestrictionForDisplay ({ definition, accessRestriction: { value, options } }) {
  const {
    key,
    display: {
      visibleIf = false,
      title = key,
      description
    },
    options: optionDefinitions
  } = definition

  const accessRestrictionVisible = visibleIf === value
  if (!accessRestrictionVisible) {
    return undefined // skip
  }

  const optionsList = compact(map(optionDefinitions, optionDefinition => mapOptionForDisplay({ optionDefinition: optionDefinition, option: options[optionDefinition.key] })))

  return {
    key,
    title,
    description,
    options: optionsList
  }
}

// Return first item with classification supported, if no item has classification supported
// return first item with classifiction undefined, if no item matches these requirements,
// return first item in list
function firstItemMatchingVersionClassification (items) {
  let defaultItem = find(items, { classification: 'supported' })
  if (defaultItem) {
    return defaultItem
  }

  defaultItem = find(items, machineImage => {
    return machineImage.classification === undefined
  })
  if (defaultItem) {
    return defaultItem
  }

  return head(items)
}

function filterShortcuts ({ getters }, { shortcuts, targetsFilter }) {
  shortcuts = filter(shortcuts, ({ target }) => (target === TargetEnum.CONTROL_PLANE && getters.hasControlPlaneTerminalAccess) || target !== TargetEnum.CONTROL_PLANE)
  shortcuts = filter(shortcuts, ({ target }) => (target === TargetEnum.GARDEN && getters.hasGardenTerminalAccess) || target !== TargetEnum.GARDEN)
  shortcuts = filter(shortcuts, ({ target }) => ((target === TargetEnum.SHOOT && getters.hasShootTerminalAccess) || target !== TargetEnum.SHOOT))
  shortcuts = filter(shortcuts, ({ target }) => includes(targetsFilter, target))
  return shortcuts
}

function decorateClassificationObject (obj) {
  const classification = obj.classification
  const isExpired = obj.expirationDate && moment().isAfter(obj.expirationDate)
  return {
    ...obj,
    isPreview: classification === 'preview',
    isSupported: !isExpired && (!classification || classification === 'supported'),
    isDeprecated: classification === 'deprecated',
    isExpired,
    expirationDateString: getDateFormatted(obj.expirationDate)
  }
}

// getters
const getters = {
  apiServerUrl (state) {
    return get(state.cfg, 'apiServerUrl', window.location.origin)
  },
  cloudProfileList (state) {
    return state.cloudProfiles.all
  },
  seedList (state) {
    return state.seeds.all
  },
  cloudProfileByName (state, getters) {
    return name => getters['cloudProfiles/cloudProfileByName'](name)
  },
  seedByName (state, getters) {
    return name => getters['seeds/seedByName'](name)
  },
  isSeedUnreachableByName (state, getters) {
    return name => {
      const seed = getters.seedByName(name)
      return get(seed, 'metadata.unreachable')
    }
  },
  cloudProfilesByCloudProviderKind (state) {
    return (cloudProviderKind) => {
      const predicate = item => item.metadata.cloudProviderKind === cloudProviderKind
      const filteredCloudProfiles = filter(state.cloudProfiles.all, predicate)
      return sortBy(filteredCloudProfiles, 'metadata.name')
    }
  },
  gardenerExtensionsList (state, getters) {
    return getters['gardenerExtensions/items']
  },
  networkingTypeList (state, getters) {
    const networkList = getters['gardenerExtensions/networkingTypes']
    return sortBy(networkList)
  },
  machineTypesOrVolumeTypesByCloudProfileNameAndRegionAndZones (state, getters) {
    const machineAndVolumeTypePredicate = unavailableItems => {
      return item => {
        if (item.usable === false) {
          return false
        }
        if (includes(unavailableItems, item.name)) {
          return false
        }
        return true
      }
    }

    return ({ type, cloudProfileName, region, zones }) => {
      if (!cloudProfileName) {
        return []
      }
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (!cloudProfile) {
        return []
      }
      const items = cloudProfile.data[type]
      if (!region || !zones) {
        return items
      }
      const regionObject = find(cloudProfile.data.regions, { name: region })
      let regionZones = get(regionObject, 'zones', [])
      regionZones = filter(regionZones, regionZone => includes(zones, regionZone.name))
      const unavailableItems = flatMap(regionZones, zone => {
        if (type === 'machineTypes') {
          return zone.unavailableMachineTypes
        } else if (type === 'volumeTypes') {
          return zone.unavailableVolumeTypes
        }
      })
      return filter(items, machineAndVolumeTypePredicate(unavailableItems))
    }
  },
  machineTypesByCloudProfileName (state, getters) {
    return ({ cloudProfileName }) => {
      return getters.machineTypesByCloudProfileNameAndRegionAndZones({ cloudProfileName })
    }
  },
  machineTypesByCloudProfileNameAndRegionAndZones (state, getters) {
    return ({ cloudProfileName, region, zones }) => {
      return getters.machineTypesOrVolumeTypesByCloudProfileNameAndRegionAndZones({ type: 'machineTypes', cloudProfileName, region, zones })
    }
  },
  volumeTypesByCloudProfileName (state, getters) {
    return ({ cloudProfileName }) => {
      return getters.volumeTypesByCloudProfileNameAndRegionAndZones({ cloudProfileName })
    }
  },
  volumeTypesByCloudProfileNameAndRegionAndZones (state, getters) {
    return ({ cloudProfileName, region, zones }) => {
      return getters.machineTypesOrVolumeTypesByCloudProfileNameAndRegionAndZones({ type: 'volumeTypes', cloudProfileName, region, zones })
    }
  },
  machineImagesByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      const machineImages = get(cloudProfile, 'data.machineImages')

      const mapMachineImages = (machineImage) => {
        const versions = filter(machineImage.versions, ({ version, expirationDate }) => {
          if (!semver.valid(version)) {
            console.error(`Skipped machine image ${machineImage.name} as version ${version} is not a valid semver version`)
            return false
          }
          return true
        })
        versions.sort((a, b) => {
          return semver.rcompare(a.version, b.version)
        })

        const name = machineImage.name
        const vendorName = vendorNameFromImageName(machineImage.name)
        const vendorHint = findVendorHint(state.cfg.vendorHints, vendorName)

        return map(versions, ({ version, expirationDate, cri, classification }) => {
          return decorateClassificationObject({
            key: name + '/' + version,
            name,
            version,
            cri,
            classification,
            expirationDate,
            vendorName,
            icon: vendorName,
            vendorHint
          })
        })
      }

      return flatMap(machineImages, mapMachineImages)
    }
  },
  zonesByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (cloudProfile) {
        return map(get(find(cloudProfile.data.regions, { name: region }), 'zones'), 'name')
      }
      return []
    }
  },
  accessRestrictionNoItemsTextForCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName: cloudProfile, region }) => {
      const noItemsText = get(state, 'cfg.accessRestriction.noItemsText', 'No access restriction options available for region ${region}') // eslint-disable-line no-template-curly-in-string

      const compiled = template(noItemsText)
      return compiled({
        region,
        cloudProfile
      })
    }
  },
  accessRestrictionDefinitionsByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      if (!cloudProfileName) {
        return undefined
      }
      if (!region) {
        return undefined
      }

      const labels = getters.labelsByCloudProfileNameAndRegion({ cloudProfileName, region })
      if (isEmpty(labels)) {
        return undefined
      }

      const items = get(state, 'cfg.accessRestriction.items')
      return filter(items, ({ key }) => {
        if (!key) {
          return false
        }
        return labels[key] === 'true'
      })
    }
  },
  accessRestrictionsForShootByCloudProfileNameAndRegion (state, getters) {
    return ({ shootResource, cloudProfileName, region }) => {
      const definitions = getters.accessRestrictionDefinitionsByCloudProfileNameAndRegion({ cloudProfileName, region })

      let accessRestrictionsMap = map(definitions, definition => mapAccessRestrictionForInput(definition, shootResource))
      accessRestrictionsMap = compact(accessRestrictionsMap)
      return fromPairs(accessRestrictionsMap)
    }
  },
  selectedAccessRestrictionsForShootByCloudProfileNameAndRegion (state, getters) {
    return ({ shootResource, cloudProfileName, region }) => {
      const definitions = getters.accessRestrictionDefinitionsByCloudProfileNameAndRegion({ cloudProfileName, region })
      const accessRestrictions = getters.accessRestrictionsForShootByCloudProfileNameAndRegion({ shootResource, cloudProfileName, region })

      return compact(map(definitions, definition => mapAccessRestrictionForDisplay({ definition, accessRestriction: accessRestrictions[definition.key] })))
    }
  },
  labelsByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (cloudProfile) {
        return get(find(cloudProfile.data.regions, { name: region }), 'labels')
      }
      return {}
    }
  },
  defaultMachineImageForCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const machineImages = getters.machineImagesByCloudProfileName(cloudProfileName)
      return firstItemMatchingVersionClassification(machineImages)
    }
  },
  shootList (state, getters) {
    return getters['shoots/filteredItems']
  },
  selectedShoot (state, getters) {
    return getters['shoots/selectedItem']
  },
  projectList (state) {
    return state.projects.all
  },
  projectFromProjectList (state, getters) {
    const predicate = project => project.metadata.namespace === state.namespace
    return find(getters.projectList, predicate) || {}
  },
  projectName (state, getters) {
    const project = getters.projectFromProjectList
    return get(project, 'metadata.name')
  },
  projectNamesFromProjectList (state, getters) {
    return map(getters.projectList, 'metadata.name')
  },
  shootCustomFieldList (state, getters) {
    return map(getters.shootCustomFields, (customFields, key) => {
      return {
        ...customFields,
        key
      }
    })
  },
  shootCustomFields (state, getters) {
    let shootCustomFields = get(getters.projectFromProjectList, 'metadata.annotations["dashboard.gardener.cloud/shootCustomFields"]')
    if (!shootCustomFields) {
      return
    }

    try {
      shootCustomFields = JSON.parse(shootCustomFields)
    } catch (error) {
      console.error('could not parse custom fields', error.message)
      return
    }

    shootCustomFields = pickBy(shootCustomFields, customField => {
      if (isEmpty(customField)) {
        return false // omit null values
      }
      if (some(customField, isObject)) {
        return false // omit custom fields with object values
      }
      return customField.name && customField.path
    })

    const defaultProperties = {
      showColumn: true,
      columnSelectedByDefault: true,
      showDetails: true,
      sortable: true,
      searchable: true
    }
    shootCustomFields = mapKeys(shootCustomFields, (customField, key) => `Z_${key}`)
    shootCustomFields = mapValues(shootCustomFields, customField => {
      return {
        ...defaultProperties,
        ...customField
      }
    })
    return shootCustomFields
  },
  costObjectSettings (state) {
    const costObject = state.cfg.costObject
    if (!costObject) {
      return undefined
    }

    const title = costObject.title || ''
    const description = costObject.description || ''
    const regex = costObject.regex
    const errorMessage = costObject.errorMessage

    return {
      regex,
      title,
      description,
      errorMessage
    }
  },
  memberList (state, getters) {
    return state.members.all
  },
  infrastructureSecretList (state) {
    return filter(state.cloudProviderSecrets.all, secret => {
      return !!secret.metadata.cloudProviderKind
    })
  },
  infrastructureSecretsByCloudProfileName (state) {
    return (cloudProfileName) => {
      return filter(state.cloudProviderSecrets.all, ['metadata.cloudProfileName', cloudProfileName])
    }
  },
  dnsSecretList (state) {
    return filter(state.cloudProviderSecrets.all, secret => {
      return !!secret.metadata.dnsProviderName && isOwnSecret(secret) // secret binding not supported
    })
  },
  dnsSecretsByProviderKind (state) {
    return (dnsProviderName) => {
      return filter(state.cloudProviderSecrets.all, secret => {
        return secret.metadata.dnsProviderName === dnsProviderName && isOwnSecret(secret) // secret binding not supported
      })
    }
  },
  getCloudProviderSecretByName (state, getters) {
    return ({ namespace, name }) => {
      return getters['cloudProviderSecrets/getCloudProviderSecretByName']({ namespace, name })
    }
  },
  namespaces (state) {
    return map(state.projects.all, 'metadata.namespace')
  },
  defaultNamespace (state, getters) {
    return includes(getters.namespaces, 'garden') ? 'garden' : head(getters.namespaces)
  },
  cloudProviderKindList (state) {
    return uniq(map(state.cloudProfiles.all, 'metadata.cloudProviderKind'))
  },
  sortedCloudProviderKindList (state, getters) {
    return intersection(['aws', 'azure', 'gcp', 'openstack', 'alicloud', 'metal', 'vsphere', 'hcloud'], getters.cloudProviderKindList)
  },
  sortedDnsProviderList (state, getters) {
    const supportedProviderTypes = ['aws-route53', 'azure-dns', 'google-clouddns', 'openstack-designate', 'alicloud-dns', 'infoblox-dns', 'netlify-dns']
    const dnsProviderList = getters['gardenerExtensions/dnsProviderList']
    // filter and sort
    return compact(map(supportedProviderTypes, poviderType => {
      return find(dnsProviderList, ['type', poviderType])
    }))
  },
  regionsWithSeedByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (!cloudProfile) {
        return []
      }
      const seedNames = cloudProfile.data.seedNames
      if (!seedNames) {
        return []
      }
      const seeds = getters.seedsByNames(seedNames)
      const uniqueSeedRegions = uniq(map(seeds, 'data.region'))
      const uniqueSeedRegionsWithZones = filter(uniqueSeedRegions, isValidRegion(getters, cloudProfileName, cloudProfile.metadata.cloudProviderKind))
      return uniqueSeedRegionsWithZones
    }
  },
  seedsByNames (state, getters) {
    return seedNames => map(seedNames, getters.seedByName)
  },
  regionsWithoutSeedByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (cloudProfile) {
        const regionsInCloudProfile = map(cloudProfile.data.regions, 'name')
        const regionsInCloudProfileWithZones = filter(regionsInCloudProfile, isValidRegion(getters, cloudProfileName, cloudProfile.metadata.cloudProviderKind))
        const regionsWithoutSeed = difference(regionsInCloudProfileWithZones, getters.regionsWithSeedByCloudProfileName(cloudProfileName))
        return regionsWithoutSeed
      }
      return []
    }
  },
  minimumVolumeSizeByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      const defaultMinimumSize = '20Gi'
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (!cloudProfile) {
        return defaultMinimumSize
      }
      const seedsForCloudProfile = cloudProfile.data.seeds
      const seedsMatchingCloudProfileAndRegion = find(seedsForCloudProfile, { data: { region } })
      return max(map(seedsMatchingCloudProfileAndRegion, 'volume.minimumSize')) || defaultMinimumSize
    }
  },
  floatingPoolNamesByCloudProfileNameAndRegionAndDomain (state, getters) {
    return ({ cloudProfileName, region, secretDomain }) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      const floatingPools = get(cloudProfile, 'data.providerConfig.constraints.floatingPools')
      let availableFloatingPools = filter(floatingPools, matchesPropertyOrEmpty('region', region))
      availableFloatingPools = filter(availableFloatingPools, matchesPropertyOrEmpty('domain', secretDomain))

      const hasRegionSpecificFloatingPool = find(availableFloatingPools, fp => !!fp.region && !fp.nonConstraining)
      if (hasRegionSpecificFloatingPool) {
        availableFloatingPools = filter(availableFloatingPools, { region })
      }
      const hasDomainSpecificFloatingPool = find(availableFloatingPools, fp => !!fp.domain && !fp.nonConstraining)
      if (hasDomainSpecificFloatingPool) {
        availableFloatingPools = filter(availableFloatingPools, { domain: secretDomain })
      }

      return uniq(map(availableFloatingPools, 'name'))
    }
  },
  loadBalancerProviderNamesByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      const loadBalancerProviders = get(cloudProfile, 'data.providerConfig.constraints.loadBalancerProviders')
      let availableLoadBalancerProviders = filter(loadBalancerProviders, matchesPropertyOrEmpty('region', region))
      const hasRegionSpecificLoadBalancerProvider = find(availableLoadBalancerProviders, lb => !!lb.region)
      if (hasRegionSpecificLoadBalancerProvider) {
        availableLoadBalancerProviders = filter(availableLoadBalancerProviders, { region })
      }
      return uniq(map(availableLoadBalancerProviders, 'name'))
    }
  },
  loadBalancerClassNamesByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const loadBalancerClasses = getters.loadBalancerClassesByCloudProfileName(cloudProfileName)
      return uniq(map(loadBalancerClasses, 'name'))
    }
  },
  loadBalancerClassesByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      return get(cloudProfile, 'data.providerConfig.constraints.loadBalancerConfig.classes')
    }
  },
  partitionIDsByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      // Partion IDs equal zones for metal infrastructure
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (get(cloudProfile, 'metadata.cloudProviderKind') !== 'metal') {
        return
      }
      const partitionIDs = getters.zonesByCloudProfileNameAndRegion({ cloudProfileName, region })
      return partitionIDs
    }
  },
  firewallSizesByCloudProfileNameAndRegionAndZones (state, getters) {
    return ({ cloudProfileName, region }) => {
      // Firewall Sizes equals to list of image types for this zone
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (get(cloudProfile, 'metadata.cloudProviderKind') !== 'metal') {
        return
      }
      const firewallSizes = getters.machineTypesByCloudProfileNameAndRegionAndZones({ cloudProfileName, region })
      return firewallSizes
    }
  },
  firewallImagesByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      return get(cloudProfile, 'data.providerConfig.firewallImages')
    }
  },
  firewallNetworksByCloudProfileNameAndPartitionId (state, getters) {
    return ({ cloudProfileName, partitionID }) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      const networks = get(cloudProfile, ['data', 'providerConfig', 'firewallNetworks', partitionID])
      return map(toPairs(networks), ([key, value]) => {
        return {
          key,
          value,
          text: `${key} [${value}]`
        }
      })
    }
  },
  shootByNamespaceAndName (state, getters) {
    return ({ namespace, name }) => {
      return getters['shoots/itemByNameAndNamespace']({ namespace, name })
    }
  },
  ticketsByNamespaceAndName (state, getters) {
    return ({ namespace, name }) => {
      const projectName = getters.projectNameByNamespace({ namespace })
      return getters['tickets/issues']({ projectName, name })
    }
  },
  ticketCommentsByIssueNumber (state, getters) {
    return ({ issueNumber }) => {
      return getters['tickets/comments']({ issueNumber })
    }
  },
  latestUpdatedTicketByNameAndNamespace (state, getters) {
    return ({ namespace, name }) => {
      const projectName = getters.projectNameByNamespace({ namespace })
      return getters['tickets/latestUpdated']({ projectName, name })
    }
  },
  ticketsLabels (state, getters) {
    return ({ namespace, name }) => {
      const projectName = getters.projectNameByNamespace({ namespace })
      return getters['tickets/labels']({ projectName, name })
    }
  },
  kubernetesVersions (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      const allVersions = get(cloudProfile, 'data.kubernetes.versions', [])
      const validVersions = filter(allVersions, ({ expirationDate, version }) => {
        if (!semver.valid(version)) {
          console.error(`Skipped Kubernetes version ${version} as it is not a valid semver version`)
          return false
        }
        return true
      })
      return map(validVersions, decorateClassificationObject)
    }
  },
  sortedKubernetesVersions (state, getters) {
    return (cloudProfileName) => {
      const kubernetsVersions = cloneDeep(getters.kubernetesVersions(cloudProfileName))
      kubernetsVersions.sort((a, b) => {
        return semver.rcompare(a.version, b.version)
      })
      return kubernetsVersions
    }
  },
  defaultKubernetesVersionForCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const k8sVersions = getters.sortedKubernetesVersions(cloudProfileName)
      return firstItemMatchingVersionClassification(k8sVersions)
    }
  },
  isAdmin (state) {
    return get(state.user, 'isAdmin', false)
  },
  ticketList (state) {
    return state.tickets.all
  },
  username (state) {
    const user = state.user
    return user ? user.email || user.id : ''
  },
  userExpiresAt (state) {
    const user = state.user
    return user ? user.exp * 1000 : 0
  },
  avatarUrl (state, getters) {
    return gravatarUrlGeneric(getters.username)
  },
  displayName (state) {
    const user = state.user
    return user ? user.name || displayName(user.id) : ''
  },
  fullDisplayName (state) {
    const user = state.user
    return user ? user.name || fullDisplayName(user.id) : ''
  },
  alertMessage (state) {
    return get(state, 'alert.message', '')
  },
  alertType (state) {
    return get(state, 'alert.type', 'error')
  },
  alertBannerMessage (state) {
    return get(state, 'cfg.alert.message')
  },
  alertBannerType (state) {
    return get(state, 'cfg.alert.type', 'error')
  },
  alertBannerIdentifier (state, getters) {
    if (!getters.alertBannerMessage) {
      return
    }
    const defaultIdentifier = hash(getters.alertBannerMessage)
    const configIdentifier = get(state, 'cfg.alert.identifier')
    const identifier = camelCase(configIdentifier) || defaultIdentifier
    // we prefix the identifier coming from the configuration so that they do not clash with our internal identifiers (e.g. for the shoot editor warning)
    return `cfg.${identifier}`
  },
  currentNamespaces (state, getters) {
    if (state.namespace === '_all') {
      return getters.namespaces
    }
    if (state.namespace) {
      return [state.namespace]
    }
    return []
  },
  isCurrentNamespace (state, getters) {
    return namespace => includes(getters.currentNamespaces, namespace)
  },
  isWebsocketConnectionError (state) {
    return get(state, 'websocketConnectionError') !== null
  },
  websocketConnectAttempt (state) {
    return get(state, 'websocketConnectionError.reconnectAttempt')
  },
  getShootListFilters (state, getters) {
    return getters['shoots/getShootListFilters']
  },
  newShootResource (state, getters) {
    return getters['shoots/newShootResource']
  },
  initialNewShootResource (state, getters) {
    return getters['shoots/initialNewShootResource']
  },
  hasGardenTerminalAccess (state, getters) {
    return getters.isTerminalEnabled && getters.canCreateTerminals
  },
  hasControlPlaneTerminalAccess (state, getters) {
    return getters.isTerminalEnabled && getters.canCreateTerminals && getters.isAdmin
  },
  hasShootTerminalAccess (state, getters) {
    return getters.isTerminalEnabled && getters.canCreateTerminals
  },
  isTerminalEnabled (state, getters) {
    return get(state, 'cfg.features.terminalEnabled', false)
  },
  isTerminalShortcutsFeatureEnabled (state, getters) {
    return !isEmpty(getters.terminalShortcutsByTargetsFilter()) || getters.isProjectTerminalShortcutsEnabled
  },
  isProjectTerminalShortcutsEnabled (state, getters) {
    return get(state, 'cfg.features.projectTerminalShortcutsEnabled', false)
  },
  canCreateTerminals (state) {
    return canI(state.subjectRules, 'create', 'dashboard.gardener.cloud', 'terminals')
  },
  canCreateShoots (state) {
    return canI(state.subjectRules, 'create', 'core.gardener.cloud', 'shoots')
  },
  canPatchShoots (state) {
    return canI(state.subjectRules, 'patch', 'core.gardener.cloud', 'shoots')
  },
  canDeleteShoots (state) {
    return canI(state.subjectRules, 'delete', 'core.gardener.cloud', 'shoots')
  },
  canGetSecrets (state) {
    return canI(state.subjectRules, 'list', '', 'secrets')
  },
  canCreateSecrets (state) {
    return canI(state.subjectRules, 'create', '', 'secrets')
  },
  canPatchSecrets (state) {
    return canI(state.subjectRules, 'patch', '', 'secrets')
  },
  canDeleteSecrets (state) {
    return canI(state.subjectRules, 'delete', '', 'secrets')
  },
  canGetProjectTerminalShortcuts (state, getters) {
    return getters.canGetSecrets
  },
  canUseProjectTerminalShortcuts (state, getters) {
    return getters.isProjectTerminalShortcutsEnabled && getters.canGetProjectTerminalShortcuts && getters.canCreateTerminals
  },
  canCreateProject (state) {
    return canI(state.subjectRules, 'create', 'core.gardener.cloud', 'projects')
  },
  canPatchProject (state, getters) {
    const name = getters.projectName
    return canI(state.subjectRules, 'patch', 'core.gardener.cloud', 'projects', name)
  },
  canManageMembers (state, getters) {
    const name = getters.projectName
    return canI(state.subjectRules, 'manage-members', 'core.gardener.cloud', 'projects', name)
  },
  canManageServiceAccountMembers (state, getters) {
    return getters.canPatchProject || getters.canManageMembers
  },
  canDeleteProject (state, getters) {
    const name = getters.projectName
    return canI(state.subjectRules, 'delete', 'core.gardener.cloud', 'projects', name)
  },
  draggingDragAndDropId (state, getters) {
    return getters['draggable/draggingDragAndDropId']
  },
  focusedElementId (state) {
    return state.focusedElementId
  },
  splitpaneResize (state) {
    return state.splitpaneResize
  },
  terminalShortcutsByTargetsFilter (state, getters) {
    return (targetsFilter = [TargetEnum.SHOOT, TargetEnum.CONTROL_PLANE, TargetEnum.GARDEN]) => {
      let shortcuts = get(state, 'cfg.terminal.shortcuts', [])
      shortcuts = map(shortcuts, shortcut => new Shortcut(shortcut, false))
      shortcuts = uniqBy(shortcuts, 'id')
      return filterShortcuts({ getters }, { shortcuts, targetsFilter })
    }
  },
  projectTerminalShortcutsByTargetsFilter (state, getters) {
    return (targetsFilter = [TargetEnum.SHOOT, TargetEnum.CONTROL_PLANE, TargetEnum.GARDEN]) => {
      if (get(state, 'projectTerminalShortcuts.namespace') !== state.namespace) {
        return
      }
      let shortcuts = get(state, 'projectTerminalShortcuts.items', [])
      shortcuts = map(shortcuts, shortcut => new Shortcut(shortcut, true))
      shortcuts = uniqBy(shortcuts, 'id')
      return filterShortcuts({ getters }, { shortcuts, targetsFilter })
    }
  },
  isKubeconfigEnabled (state) {
    return !!(get(state, 'kubeconfigData.oidc.clientId') && get(state, 'kubeconfigData.oidc.clientSecret'))
  },
  onlyShootsWithIssues (state, getters) {
    return getters['shoots/onlyShootsWithIssues']
  },
  projectNameByNamespace (state, getters) {
    return ({ namespace } = {}) => {
      const project = find(getters.projectList, ['metadata.namespace', namespace])
      return get(project, 'metadata.name') || replace(namespace, /^garden-/, '')
    }
  },
  purposeRequiresHibernationSchedule (state) {
    return purpose => {
      const defaultHibernationSchedules = get(state, 'cfg.defaultHibernationSchedule')
      if (defaultHibernationSchedules) {
        if (isEmpty(purpose)) {
          return true
        }
        return !isEmpty(get(defaultHibernationSchedules, purpose))
      }
      return false
    }
  },
  isShootHasNoHibernationScheduleWarning (state, getters) {
    return shoot => {
      const purpose = get(shoot, 'spec.purpose')
      const annotations = get(shoot, 'metadata.annotations', {})
      if (getters.purposeRequiresHibernationSchedule(purpose)) {
        const hasNoScheduleFlag = !!annotations['dashboard.garden.sapcloud.io/no-hibernation-schedule']
        if (!hasNoScheduleFlag && isEmpty(get(shoot, 'spec.hibernation.schedules'))) {
          return true
        }
      }
      return false
    }
  },
  generateWorker (state, getters) {
    return (availableZones, cloudProfileName, region, kubernetesVersion) => {
      const id = uuidv4()
      const name = `worker-${shortRandomString(5)}`
      const zones = !isEmpty(availableZones) ? [sample(availableZones)] : undefined
      const machineTypesForZone = getters.machineTypesByCloudProfileNameAndRegionAndZones({ cloudProfileName, region, zones })
      const machineType = head(machineTypesForZone) || {}
      const volumeTypesForZone = getters.volumeTypesByCloudProfileNameAndRegionAndZones({ cloudProfileName, region, zones })
      const volumeType = head(volumeTypesForZone) || {}
      const machineImage = getters.defaultMachineImageForCloudProfileName(cloudProfileName)
      const minVolumeSize = getters.minimumVolumeSizeByCloudProfileNameAndRegion({ cloudProfileName, region })
      const defaultVolumeSize = parseSize(minVolumeSize) <= parseSize('50Gi') ? '50Gi' : minVolumeSize
      const worker = {
        id,
        name,
        minimum: 1,
        maximum: 2,
        maxSurge: 1,
        machine: {
          type: machineType.name,
          image: pick(machineImage, ['name', 'version'])
        },
        zones,
        cri: {
          name: defaultCriNameByKubernetesVersion(map(machineImage.cri, 'name'), kubernetesVersion)
        },
        isNew: true
      }
      if (volumeType.name) {
        worker.volume = {
          type: volumeType.name,
          size: defaultVolumeSize
        }
      } else if (!machineType.storage) {
        worker.volume = {
          size: defaultVolumeSize
        }
      } else if (machineType.storage.type !== 'fixed') {
        worker.volume = {
          size: machineType.storage.size
        }
      }
      return worker
    }
  },
  availableKubernetesUpdatesForShoot (state, getters) {
    return (shootVersion, cloudProfileName) => {
      const key = `${shootVersion}_${cloudProfileName}`
      let newerVersions = availableKubernetesUpdatesCache.get(key)
      if (newerVersions !== undefined) {
        return newerVersions
      }
      newerVersions = {}
      const allVersions = getters.kubernetesVersions(cloudProfileName)

      const validVersions = filter(allVersions, ({ isExpired }) => !isExpired)
      const newerVersionsForShoot = filter(validVersions, ({ version }) => semver.gt(version, shootVersion))
      forEach(newerVersionsForShoot, version => {
        const diff = semver.diff(version.version, shootVersion)
        if (!newerVersions[diff]) {
          newerVersions[diff] = []
        }
        newerVersions[diff].push(version)
      })
      newerVersions = newerVersionsForShoot.length ? newerVersions : null
      availableKubernetesUpdatesCache.set(key, newerVersions)

      return newerVersions
    }
  },
  kubernetesVersionIsNotLatestPatch (state, getters) {
    return (kubernetesVersion, cloudProfileName) => {
      const allVersions = getters.kubernetesVersions(cloudProfileName)
      return some(allVersions, ({ version, isPreview }) => {
        return semver.diff(version, kubernetesVersion) === 'patch' && semver.gt(version, kubernetesVersion) && !isPreview
      })
    }
  },
  kubernetesVersionUpdatePathAvailable (state, getters) {
    return (kubernetesVersion, cloudProfileName) => {
      const allVersions = getters.kubernetesVersions(cloudProfileName)
      if (getters.kubernetesVersionIsNotLatestPatch(kubernetesVersion, cloudProfileName)) {
        return true
      }
      const versionMinorVersion = semver.minor(kubernetesVersion)
      return some(allVersions, ({ version, isPreview }) => {
        return semver.minor(version) === versionMinorVersion + 1 && !isPreview
      })
    }
  },
  kubernetesVersionExpirationForShoot (state, getters) {
    return (shootK8sVersion, shootCloudProfileName, k8sAutoPatch) => {
      const allVersions = getters.kubernetesVersions(shootCloudProfileName)
      const version = find(allVersions, { version: shootK8sVersion })
      if (!version) {
        return {
          version: shootK8sVersion,
          expirationDate: UNKNOWN_EXPIRED_TIMESTAMP,
          isValidTerminationDate: false,
          severity: 'warning'
        }
      }
      if (!version.expirationDate) {
        return undefined
      }

      const patchAvailable = getters.kubernetesVersionIsNotLatestPatch(shootK8sVersion, shootCloudProfileName)
      const updatePathAvailable = getters.kubernetesVersionUpdatePathAvailable(shootK8sVersion, shootCloudProfileName)

      let severity
      if (!updatePathAvailable) {
        severity = 'error'
      } else if ((!k8sAutoPatch && patchAvailable) || !patchAvailable) {
        severity = 'warning'
      } else if (k8sAutoPatch && patchAvailable) {
        severity = 'info'
      } else {
        return undefined
      }

      return {
        expirationDate: version.expirationDate,
        isValidTerminationDate: isValidTerminationDate(version.expirationDate),
        severity
      }
    }
  },
  expiringWorkerGroupsForShoot (state, getters) {
    return (shootWorkerGroups, shootCloudProfileName, imageAutoPatch) => {
      const allMachineImages = getters.machineImagesByCloudProfileName(shootCloudProfileName)
      const workerGroups = map(shootWorkerGroups, worker => {
        const workerImage = get(worker, 'machine.image')
        const workerImageDetails = find(allMachineImages, workerImage)
        if (!workerImageDetails) {
          return {
            ...workerImage,
            expirationDate: UNKNOWN_EXPIRED_TIMESTAMP,
            workerName: worker.name,
            isValidTerminationDate: false,
            severity: 'warning'
          }
        }

        const updateAvailable = selectedImageIsNotLatest(workerImageDetails, allMachineImages)

        let severity
        if (!updateAvailable) {
          severity = 'error'
        } else if (!imageAutoPatch) {
          severity = 'warning'
        } else {
          severity = 'info'
        }

        return {
          ...workerImageDetails,
          isValidTerminationDate: isValidTerminationDate(workerImageDetails.expirationDate),
          workerName: worker.name,
          severity
        }
      })
      return filter(workerGroups, 'expirationDate')
    }
  },
  defaultGardenctlOptions (state) {
    return {
      legacyCommands: false,
      shell: 'bash',
      ...get(state, 'cfg.gardenctl')
    }
  }
}

// actions
const actions = {
  fetchAll ({ dispatch, commit }, resources) {
    const iteratee = (value, key) => dispatch(key, value)
    return Promise
      .all(map(resources, iteratee))
      .catch(err => {
        dispatch('setError', err)
      })
  },
  fetchCloudProfiles ({ dispatch }) {
    return dispatch('cloudProfiles/getAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  async fetchGardenerExtensions ({ dispatch }) {
    try {
      await dispatch('gardenerExtensions/getAll')
    } catch (err) {
      dispatch('setError', err)
    }
  },
  async fetchSeeds ({ dispatch }) {
    try {
      await dispatch('seeds/getAll')
    } catch (err) {
      dispatch('setError', err)
    }
  },
  fetchProjects ({ dispatch }) {
    return dispatch('projects/getAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  fetchMembers ({ dispatch, commit }) {
    return dispatch('members/getAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  fetchcloudProviderSecrets ({ dispatch, commit }) {
    return dispatch('cloudProviderSecrets/getAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  clearShoots ({ dispatch, commit }) {
    return dispatch('shoots/clearAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  clearIssues ({ dispatch, commit }) {
    return dispatch('tickets/clearIssues')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  clearComments ({ dispatch, commit }) {
    return dispatch('tickets/clearComments')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  async subscribeShoot ({ commit, dispatch, getters }, { name, namespace }) {
    await dispatch('shoots/clearAll')
    return new Promise((resolve, reject) => {
      const done = err => {
        unsubscribe()
        clearTimeout(timeoutId)
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      }
      const handleSubscriptionTimeout = () => {
        done(Object.assign(new Error('Cluster subscription timed out'), {
          code: 504,
          reason: 'Timeout'
        }))
      }
      const handleSubscriptionAcknowledgement = object => {
        if (object.kind === 'Status') {
          let { code, reason, message } = object
          if (code === 404) {
            reason = 'Cluster not found'
            message = 'The cluster you are looking for doesn\'t exist'
          } else if (code === 403) {
            reason = 'Access to cluster denied'
          } else if (code >= 500) {
            reason = 'Oops, something went wrong'
            message = 'An unexpected error occurred. Please try again later'
          }
          done(Object.assign(new Error(message), { code, reason }))
        } else {
          done()
        }
      }
      const unsubscribe = store.subscribeAction(({ type, payload }, state) => {
        if (type === 'subscribeShootAcknowledgement') {
          handleSubscriptionAcknowledgement(payload)
        }
      })
      const timeoutId = setTimeout(handleSubscriptionTimeout, 36 * 1000)
      commit('SUBSCRIBE', ['shoot', { name, namespace }])
    })
  },
  subscribeShootAcknowledgement ({ commit, dispatch, state, getters }, object) {
    if (object.kind === 'Shoot') {
      commit('shoots/HANDLE_EVENTS', {
        rootState: state,
        rootGetters: getters,
        events: [{
          type: 'ADDED',
          object
        }]
      })
      const fetchShootAndShootSeedInfo = async ({ metadata, spec }) => {
        const promises = [dispatch('getShootInfo', metadata)]
        const seedName = spec.seedName
        if (getters.isAdmin && !getters.isSeedUnreachableByName(seedName)) {
          promises.push(dispatch('getShootSeedInfo', metadata))
        }
        try {
          await Promise.all(promises)
        } catch (err) {
          console.error('Failed to fetch shoot or shootSeed info:', err.message)
        }
      }
      fetchShootAndShootSeedInfo(object)
    }
  },
  getShootInfo ({ dispatch, commit }, { name, namespace }) {
    return dispatch('shoots/getInfo', { name, namespace })
      .catch(err => {
        dispatch('setError', err)
      })
  },
  getShootSeedInfo ({ dispatch, commit }, { name, namespace }) {
    return dispatch('shoots/getSeedInfo', { name, namespace })
      .catch(err => {
        dispatch('setError', err)
      })
  },
  async subscribeShoots ({ dispatch, commit, state, getters }) {
    try {
      const namespace = state.namespace
      const filter = getFilterValue(state, getters)
      commit('SUBSCRIBE', ['shoots', { namespace, filter }])
    } catch (err) { /* ignore error */ }
  },
  async subscribeComments ({ dispatch, commit }, { name, namespace }) {
    try {
      commit('SUBSCRIBE', ['comments', { name, namespace }])
    } catch (err) { /* ignore error */ }
  },
  async unsubscribeComments ({ dispatch, commit }) {
    try {
      commit('UNSUBSCRIBE', 'comments')
    } catch (err) { /* ignore error */ }
  },
  setSelectedShoot ({ dispatch }, metadata) {
    return dispatch('shoots/setSelection', metadata)
      .catch(err => {
        dispatch('setError', err)
      })
  },
  async setShootListFilters ({ dispatch, getters }, value) {
    try {
      await dispatch('shoots/setShootListFilters', value)
    } catch (err) {
      dispatch('setError', err)
    }
  },
  async setShootListFilter ({ dispatch, getters }, { filter, value }) {
    try {
      await dispatch('shoots/setShootListFilter', { filter, value })
    } catch (err) {
      dispatch('setError', err)
    }
  },
  setNewShootResource ({ dispatch }, data) {
    return dispatch('shoots/setNewShootResource', data)
  },
  resetNewShootResource ({ dispatch }) {
    return dispatch('shoots/resetNewShootResource')
  },
  createProject ({ dispatch, commit }, data) {
    return dispatch('projects/create', data)
      .then(res => {
        dispatch('setAlert', { message: 'Project created', type: 'success' })
        return res
      })
  },
  patchProject ({ dispatch, commit }, data) {
    return dispatch('projects/patch', data)
  },
  updateProject ({ dispatch, commit }, data) {
    return dispatch('projects/update', data)
      .then(res => {
        dispatch('setAlert', { message: 'Project updated', type: 'success' })
        return res
      })
  },
  deleteProject ({ dispatch, commit }, data) {
    return dispatch('projects/delete', data)
      .then(res => {
        dispatch('setAlert', { message: 'Project deleted', type: 'success' })
        return res
      })
  },
  createCloudProviderSecret ({ dispatch, commit }, data) {
    return dispatch('cloudProviderSecrets/create', data)
      .then(res => {
        dispatch('setAlert', { message: 'Cloud Provider secret created', type: 'success' })
        return res
      })
  },
  updateCloudProviderSecret ({ dispatch, commit }, data) {
    return dispatch('cloudProviderSecrets/update', data)
      .then(res => {
        dispatch('setAlert', { message: 'Cloud Provider secret updated', type: 'success' })
        return res
      })
  },
  deleteCloudProviderSecret ({ dispatch, commit }, data) {
    return dispatch('cloudProviderSecrets/delete', data)
      .then(res => {
        dispatch('setAlert', { message: 'Cloud Provider secret deleted', type: 'success' })
        return res
      })
  },
  createShoot ({ dispatch, commit }, data) {
    return dispatch('shoots/create', data)
      .then(res => {
        dispatch('setAlert', { message: 'Cluster created', type: 'success' })
        return res
      })
  },
  deleteShoot ({ dispatch, commit }, { name, namespace }) {
    return dispatch('shoots/delete', { name, namespace })
      .then(res => {
        dispatch('setAlert', { message: 'Cluster marked for deletion', type: 'success' })
        return res
      })
  },
  async addMember ({ dispatch, commit }, payload) {
    const result = await dispatch('members/add', payload)
    await dispatch('setAlert', { message: 'Member added', type: 'success' })
    return result
  },
  async updateMember ({ dispatch, commit }, payload) {
    const result = await dispatch('members/update', payload)
    await dispatch('setAlert', { message: 'Member updated', type: 'success' })
    return result
  },
  async deleteMember ({ dispatch, commit }, payload) {
    try {
      const result = await dispatch('members/delete', payload)
      await dispatch('setAlert', { message: 'Member deleted', type: 'success' })
      return result
    } catch (err) {
      await dispatch('setError', { message: `Delete member failed. ${err.message}` })
    }
  },
  async rotateServiceAccountSecret ({ dispatch, commit }, payload) {
    try {
      const result = await dispatch('members/rotateServiceAccountSecret', payload)
      await dispatch('setAlert', { message: 'Service Account Secret Rotation started', type: 'success' })
      return result
    } catch (err) {
      await dispatch('setError', { message: `Failed to Rotate Service Account Secret ${err.message}` })
    }
  },
  setConfiguration ({ commit, getters }, value) {
    commit('SET_CONFIGURATION', value)

    forEach(value.knownConditions, (conditionValue, conditionKey) => {
      commit('setCondition', { conditionKey, conditionValue })
    })

    const themes = get(Vue, 'vuetify.framework.theme.themes')
    if (themes) {
      for (const name of ['light', 'dark']) {
        const theme = get(Vue.vuetify.framework.theme.themes, name)
        const themeConfiguration = get(state.cfg.themes, name)
        forOwn(themeConfiguration, (value, key) => {
          const color = get(colors, value)
          if (color) {
            theme[key] = color
          } else if (isHtmlColorCode(value)) {
            theme[key] = value
          }
        })
      }
    }

    return state.cfg
  },
  async setNamespace ({ dispatch, commit }, namespace) {
    commit('SET_NAMESPACE', namespace)
    await dispatch('refreshSubjectRules', namespace)
    return state.namespace
  },
  async refreshSubjectRules ({ commit }, namespace) {
    try {
      const { data: subjectRules } = await getSubjectRules({ namespace })
      commit('SET_SUBJECT_RULES', subjectRules)
    } catch (err) {
      commit('SET_SUBJECT_RULES', undefined)
      throw err
    }
    return state.subjectRules
  },
  async fetchKubeconfigData ({ commit }) {
    const { data } = await getKubeconfigData()
    commit('SET_KUBECONFIG_DATA', data)
  },
  async ensureProjectTerminalShortcutsLoaded ({ commit, dispatch, state }) {
    const { namespace, projectTerminalShortcuts } = state
    if (!projectTerminalShortcuts || projectTerminalShortcuts.namespace !== namespace) {
      try {
        const { data: items } = await listProjectTerminalShortcuts({ namespace })
        commit('SET_PROJECT_TERMINAL_SHORTCUTS', {
          namespace,
          items
        })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Failed to list project terminal shortcuts:', err.message)
      }
    }
  },
  setUser ({ dispatch, commit }, value) {
    commit('SET_USER', value)
    return state.user
  },
  unsetUser ({ dispatch, commit }) {
    commit('SET_USER', null)
  },
  setSidebar ({ commit }, value) {
    commit('SET_SIDEBAR', value)
    return state.sidebar
  },
  setLoading ({ commit }) {
    commit('SET_LOADING', true)
    return state.loading
  },
  unsetLoading ({ commit }) {
    commit('SET_LOADING', false)
    return state.loading
  },
  setWebsocketConnectionError ({ commit }, { reason, reconnectAttempt }) {
    commit('SET_WEBSOCKET_CONNECTION_ERROR', { reason, reconnectAttempt })
    return state.websocketConnectionError
  },
  unsetWebsocketConnectionError ({ commit }) {
    commit('SET_WEBSOCKET_CONNECTION_ERROR', null)
    return state.websocketConnectionError
  },
  setError ({ commit }, value) {
    commit('SET_ALERT', { message: get(value, 'message', ''), type: 'error' })
    return state.alert
  },
  setAlert ({ commit }, value) {
    commit('SET_ALERT', value)
    return state.alert
  },
  setDraggingDragAndDropId ({ dispatch }, draggingDragAndDropId) {
    return dispatch('draggable/setDraggingDragAndDropId', draggingDragAndDropId)
  },
  setSplitpaneResize ({ commit }, value) { // TODO setSplitpaneResize called too often
    commit('SET_SPLITPANE_RESIZE', value)
    return state.splitpaneResize
  },
  setColorScheme ({ commit }, colorScheme) {
    commit('SET_COLOR_SCHEME', colorScheme)
    return state.colorScheme
  }
}

// mutations
const mutations = {
  SET_CONFIGURATION (state, value) {
    state.cfg = value
  },
  SET_READY (state, value) {
    state.ready = value
  },
  SET_NAMESPACE (state, value) {
    if (value !== state.namespace) {
      state.namespace = value
      // no need to subscribe for shoots here as this is done in the router on demand (as not all routes require the shoots to be loaded)
    }
  },
  SET_SUBJECT_RULES (state, value) {
    state.subjectRules = value
  },
  SET_KUBECONFIG_DATA (state, value) {
    state.kubeconfigData = value
  },
  SET_PROJECT_TERMINAL_SHORTCUTS (state, value) {
    state.projectTerminalShortcuts = value
  },
  SET_USER (state, value) {
    state.user = value
  },
  SET_SIDEBAR (state, value) {
    state.sidebar = value
  },
  SET_LOADING (state, value) {
    state.loading = value
  },
  SET_SHOOTS_LOADING (state, value) {
    state.shootsLoading = value
  },
  SET_WEBSOCKET_CONNECTION_ERROR (state, value) {
    if (value) {
      state.websocketConnectionError = merge({}, state.websocketConnectionError, value)
    } else {
      state.websocketConnectionError = null
    }
  },
  SET_ALERT (state, value) {
    state.alert = value
  },
  setCondition (state, { conditionKey, conditionValue }) {
    Vue.set(state.conditionCache, conditionKey, conditionValue)
  },
  SET_FOCUSED_ELEMENT_ID (state, value) {
    state.focusedElementId = value
  },
  UNSET_FOCUSED_ELEMENT_ID (state, value) {
    if (state.focusedElementId === value) {
      state.focusedElementId = null
    }
  },
  SET_SPLITPANE_RESIZE (state, value) {
    state.splitpaneResize = value
  },
  SET_COLOR_SCHEME (state, value) {
    state.colorScheme = value
    localStorage.setItem('global/color-scheme', value)
  },
  SET_DARK_THEME (state, value) {
    state.darkTheme = value
    Vue.vuetify.framework.theme.dark = value
  },
  SUBSCRIBE (state, [key, value]) {
    Vue.set(state.subscriptions, key, value)
  },
  UNSUBSCRIBE (state, key) {
    Vue.delete(state.subscriptions, key)
  },
  SET_GARDENCTL_OPTIONS (state, value) {
    state.gardenctlOptions = value
    localStorage.setObject('global/gardenctl', value)
  }
}

const modules = {
  projects,
  members,
  draggable,
  cloudProfiles,
  gardenerExtensions,
  seeds,
  shoots,
  cloudProviderSecrets,
  tickets,
  shootStaging
}

const store = new Vuex.Store({
  state,
  getters,
  actions,
  mutations,
  modules,
  strict,
  plugins
})

export default store

export {
  state,
  getters,
  actions,
  mutations,
  modules,
  plugins,
  mapAccessRestrictionForInput,
  firstItemMatchingVersionClassification
}
