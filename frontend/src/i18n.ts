import { createI18n } from 'vue-i18n';

export const LOCALE_STORAGE_KEY = 'esphome-online-compiler:locale';
export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const FALLBACK_LOCALE: SupportedLocale = 'en';

const messages = {
  en: {
    app: {
      title: 'ESPHome Online Compiler',
      localeLabel: 'Language',
      locales: {
        en: 'English',
        zh: '中文'
      }
    },
    compileForm: {
      loading: 'Loading...',
      missingScopes:
        'The current authorization is missing the following scopes: {scopes}. Please sign out and authorize again.',
      fields: {
        yaml: {
          label: 'ESPHome YAML'
        },
        esphomeVersion: {
          label: 'ESPHome Version',
          customPlaceholder: 'Example: 2025.10.1',
          hint: 'Leave empty to use the latest stable release, or enter a specific version to compile an earlier release.',
          options: {
            latest: 'Latest stable (auto)',
            custom: 'Custom...'
          },
          defaultLabel: 'Latest stable'
        },
        artifactPassword: {
          label: 'Archive Password',
          placeholder: 'Auto-generated 16-character alphanumeric value',
          regenerate: 'Regenerate',
          hint: 'You will need this password to unzip the firmware artifact. Use 8-64 alphanumeric characters.'
        }
      },
      secrets: {
        title: 'Secret Replacement',
        description:
          'Detected <code>!secret</code> placeholders in your YAML. Provide the actual values below.',
        inputPlaceholder: 'Enter value',
        missing: 'Still missing {count} secret value(s): {names}'
      },
      actions: {
        hideSecret: 'Hide',
        showSecret: 'Show',
        submitting: 'Submitting...',
        submit: 'Start compilation',
        reset: 'Reset'
      },
      auth: {
        avatarAlt: 'User avatar',
        logout: 'Sign out',
        login: 'Authorize with personal GitHub',
        encouragePersonal:
          'The platform GitHub authorization is unavailable right now. Please continue with your personal GitHub.'
      },
      submitHints: {
        loginRequired: 'Please authorize with GitHub before submitting a build.',
        missingScopes:
          'Your GitHub authorization is missing the workflow/public_repo permissions. Please re-authorize.'
      },
      status: {
        sectionTitle: 'Compilation Status',
        requestId: 'Request ID:',
        runId: 'Workflow Run ID:',
        currentStatus: 'Current status:',
        runLinkLabel: 'GitHub Workflow:',
        openRun: 'Open',
        esphomeVersion: 'ESPHome version:',
        artifactPassword: 'Archive password:',
        artifact: 'Firmware artifact:',
        downloading: 'Downloading...',
        downloadArtifact: 'Download {name}.zip',
        workflowQueued: 'Workflow triggered. Waiting to run...',
        errorLogs: 'Error Logs',
        loadingLogs: 'Loading error logs...'
      },
      statusDisplay: {
        notStarted: 'Not started',
        completed: 'Completed',
        status: {
          queued: 'Queued',
          in_progress: 'In progress',
          waiting: 'Waiting',
          pending: 'Pending',
          requested: 'Requested'
        },
        conclusion: {
          success: 'Succeeded',
          failure: 'Failed',
          cancelled: 'Cancelled',
          timed_out: 'Timed out',
          neutral: 'Neutral',
          skipped: 'Skipped',
          action_required: 'Action required',
          stale: 'Stale',
          startup_failure: 'Startup failure'
        }
      },
      errors: {
        invalidYaml: 'Please provide valid YAML content.',
        loginRequired: 'Please sign in with GitHub before submitting a build.',
        missingScopes: 'Your GitHub authorization is missing required permissions. Please re-authorize.',
        secretsMissing: 'Provide values for the following secrets: {names}',
        yamlTooLarge: 'The YAML file is too large. Keep it under 200KB.',
        passwordRequired: 'Set a password for decrypting the artifact.',
        passwordLength: 'The password must be between 8 and 64 characters.',
        passwordCharset: 'The password may only contain letters and numbers.',
        triggerFailed: 'Failed to trigger the workflow. Please try again later.',
        statusFailed: 'Failed to refresh the workflow status.',
        downloadFailed: 'Failed to download the firmware. Check your permissions or try again later.'
      }
    }
  },
  zh: {
    app: {
      title: 'ESPHome 在线编译',
      localeLabel: '语言',
      locales: {
        en: '英语',
        zh: '中文'
      }
    },
    compileForm: {
      loading: '正在加载...',
      missingScopes: '当前授权缺少以下 scope：{scopes}，请退出后重新授权。',
      fields: {
        yaml: {
          label: 'ESPHome YAML'
        },
        esphomeVersion: {
          label: 'ESPHome 版本',
          customPlaceholder: '例如 2025.10.1',
          hint: '留空将使用最新稳定版，也可输入具体版本号编译历史版本。',
          options: {
            latest: '最新稳定版（自动）',
            custom: '自定义...'
          },
          defaultLabel: '最新稳定版'
        },
        artifactPassword: {
          label: '压缩包密码',
          placeholder: '自动生成 16 位字母数字组合',
          regenerate: '重新生成',
          hint: '下载固件产物后需要该密码才能解压，建议使用 8-64 位字母或数字组合。'
        }
      },
      secrets: {
        title: 'Secret 替换',
        description:
          '检测到 YAML 中包含 <code>!secret</code> 占位符，请在下方填写对应的真实值。',
        inputPlaceholder: '请输入值',
        missing: '仍有 {count} 个 secret 未填写：{names}'
      },
      actions: {
        hideSecret: '隐藏',
        showSecret: '显示',
        submitting: '正在提交...',
        submit: '提交编译',
        reset: '重置'
      },
      auth: {
        avatarAlt: '用户头像',
        logout: '退出',
        login: '个人 GitHub 授权',
        encouragePersonal: '平台 GitHub 授权当前不可用，请使用个人 GitHub 授权继续编译。'
      },
      submitHints: {
        loginRequired: '请先完成 GitHub 授权后再提交编译。',
        missingScopes: '当前 GitHub 授权缺少 workflow/public_repo 权限，请重新授权后再试。'
      },
      status: {
        sectionTitle: '编译状态',
        requestId: '请求 ID:',
        runId: 'Workflow Run ID:',
        currentStatus: '当前状态:',
        runLinkLabel: 'GitHub Workflow:',
        openRun: '打开',
        esphomeVersion: 'ESPHome 版本:',
        artifactPassword: '解压密码:',
        artifact: '固件产物:',
        downloading: '下载中...',
        downloadArtifact: '下载 {name}.zip',
        workflowQueued: 'Workflow 已触发，等待运行...',
        errorLogs: '错误日志',
        loadingLogs: '正在加载错误日志...'
      },
      statusDisplay: {
        notStarted: '尚未开始',
        completed: '完成',
        status: {
          queued: '排队中',
          in_progress: '运行中',
          waiting: '等待中',
          pending: '准备中',
          requested: '已请求'
        },
        conclusion: {
          success: '完成',
          failure: '失败',
          cancelled: '已取消',
          timed_out: '超时',
          neutral: '中性',
          skipped: '已跳过',
          action_required: '需要操作',
          stale: '已过期',
          startup_failure: '启动失败'
        }
      },
      errors: {
        invalidYaml: '请输入有效的 YAML 内容。',
        loginRequired: '请先登录 GitHub 后再提交编译。',
        missingScopes: '当前授权缺少必要的 GitHub 权限，请重新授权。',
        secretsMissing: '请为以下 secret 提供具体值：{names}',
        yamlTooLarge: 'YAML 太大，请控制在 200KB 内。',
        passwordRequired: '请设置用于解压产物的密码。',
        passwordLength: '密码长度需在 8 到 64 个字符之间。',
        passwordCharset: '密码仅支持字母与数字组合。',
        triggerFailed: '触发编译失败，请稍后再试。',
        statusFailed: '获取状态失败。',
        downloadFailed: '下载固件失败，请检查权限或稍后重试。'
      }
    }
  }
} as const;

function isSupportedLocale(locale: string | null | undefined): locale is SupportedLocale {
  if (!locale) {
    return false;
  }
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

function readStoredLocale(): SupportedLocale | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && isSupportedLocale(stored)) {
      return stored;
    }
  } catch (error) {
    console.warn('Failed to load stored locale', error);
  }
  return null;
}

function detectBrowserLocale(): SupportedLocale {
  if (typeof window === 'undefined') {
    return FALLBACK_LOCALE;
  }

  const stored = readStoredLocale();
  if (stored) {
    return stored;
  }

  const browserLocales = window.navigator.languages ?? [window.navigator.language];

  for (const locale of browserLocales) {
    if (!locale) continue;
    const normalized = locale.toLowerCase();
    if (isSupportedLocale(normalized)) {
      return normalized;
    }
    const base = normalized.split('-')[0];
    if (isSupportedLocale(base)) {
      return base;
    }
  }

  return FALLBACK_LOCALE;
}

export function persistLocale(locale: SupportedLocale) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch (error) {
    console.warn('Failed to persist locale', error);
  }
}

export const i18n = createI18n({
  legacy: false,
  locale: detectBrowserLocale(),
  fallbackLocale: FALLBACK_LOCALE,
  messages
});
