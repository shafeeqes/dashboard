<!--
SPDX-FileCopyrightText: 2021 SAP SE or an SAP affiliate company and Gardener contributors

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <v-list-item>
    <v-list-item-avatar v-if="avatarUrl" class="align-self-start">
      <v-avatar size="40px">
        <img :src="avatarUrl" :title="login" :alt="`avatar of github user ${login}`" />
      </v-avatar>
    </v-list-item-avatar>
    <v-list-item-icon v-else class="align-self-start">
      <v-icon color="primary">mdi-comment-outline</v-icon>
    </v-list-item-icon>
    <v-list-item-content class="comment">
      <v-list-item-title class="comment-header toolbar-background toolbar-title--text">
        <span class="font-weight-bold">{{login}}</span> commented <a :href="sanitizeUrl(htmlUrl)" target="_blank" rel="noopener"><time-string :date-time="createdAt" mode="past" class="toolbar-title--text"></time-string></a>
      </v-list-item-title>
      <v-list-item-subtitle class="wrap-text comment-body" v-html="commentHtml"></v-list-item-subtitle>
    </v-list-item-content>
    </v-list-item>
</template>

<script>
import get from 'lodash/get'
import { gravatarUrlIdenticon, transformHtml } from '@/utils'
import TimeString from '@/components/TimeString'
import { mapState } from 'vuex'
import sanitizeUrl from '@/mixins/sanitizeUrl'

const AvatarEnum = {
  GITHUB: 'github', // default
  GRAVATAR: 'gravatar',
  NONE: 'none'
}

export default {
  components: {
    TimeString
  },
  mixins: [sanitizeUrl],
  props: {
    comment: {
      type: Object,
      required: true
    }
  },
  computed: {
    ...mapState([
      'cfg'
    ]),
    commentHtml () {
      return transformHtml(get(this.comment, 'data.body', ''))
    },
    login () {
      return get(this.comment, 'data.user.login')
    },
    createdAt () {
      return get(this.comment, 'metadata.created_at')
    },
    avatarSource () {
      return get(this.cfg, 'ticket.avatarSource', AvatarEnum.GITHUB)
    },
    avatarUrl () {
      switch (this.avatarSource) {
        case AvatarEnum.GITHUB:
          return get(this.comment, 'data.user.avatar_url')
        case AvatarEnum.GRAVATAR:
          return gravatarUrlIdenticon(this.login)
        default:
          return undefined
      }
    },
    htmlUrl () {
      return get(this.comment, 'data.html_url')
    }
  }
}
</script>

<style lang="scss" scoped>
  @import '~vuetify/src/styles/styles.sass';

  $gh-code-background-color: map-get($grey, 'lighten-4');
  $gh-code-color: map-get($grey, 'darken-4');

  .comment {
    padding: 0;
    margin-bottom: 12px;
  }
  .wrap-text {
    white-space: normal;
  }

  .comment-header {
    border-top-left-radius: 2px;
    border-top-right-radius: 2px;
    border: 0.5px;

    padding: 4px 8px;
    margin-bottom: 0;
  }

  .comment-body {
    border: 0.5px solid;

    padding: 4px 8px;

    /* not needed for chrome, but kept for firefox */
    word-wrap: break-word;
    /* does not work with firefox */
    word-break: break-word;

    ::v-deep pre {
      padding: 8px;
      border-radius: 3px;
      white-space: pre;
      overflow: auto;
      background-color: $gh-code-background-color;
      & > code {
        padding: 0;
        color: $gh-code-color;
        background-color: transparent;
        background-attachment: scroll;
        font-weight: normal;
        box-shadow: none;
        -webkit-box-shadow: none;
        &:before {
          content: none;
        }
      }
    }

    ::v-deep code {
      padding: .2em .4em;
      border-radius: 3px;
      font-weight: normal;
      color: $gh-code-color;
      background-color: $gh-code-background-color;
    }

    ::v-deep img {
      max-width: 100%;
    }

    ::v-deep > h1 {
      font-size: 21px;
      font-weight: 600;
    }

    ::v-deep > h2 {
      font-size: 17.5px;
      font-weight: 600;
    }

    ::v-deep > h3 {
      font-size: 14px;
      font-weight: 600;
    }

    ::v-deep > h4 {
      font-size: 12.25px;
      font-weight: 600;
    }

    ::v-deep > h5 {
      font-size: 11.9px;
      font-weight: 600;
    }

    ::v-deep > h6 {
      font-size: 11.5px;
      font-weight: 600;
    }
  }

  ::v-deep .flex {
    width: 200px;
  }

  a {
    text-decoration: none;
  }

  a:hover{
    text-decoration: underline;
  }
</style>
