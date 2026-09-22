export const WHMCS_EVENT_DEFINITIONS = [
  {
    key: "OrderPaid",
    label: "Order paid",
    description: "Notify after a client order is marked paid.",
    defaultTemplate: "Hi {client_name}, your order #{order_id} has been paid. Thank you!",
  },
  {
    key: "InvoiceCreated",
    label: "Invoice created",
    description: "Notify when a new client invoice is created.",
    defaultTemplate: "Hi {client_name}, invoice #{invoice_id} has been created for {amount}. Due {due_date}.",
  },
  {
    key: "InvoicePaymentReminder",
    label: "Invoice payment reminder",
    description: "Notify when WHMCS raises an invoice payment reminder.",
    defaultTemplate: "Hi {client_name}, reminder: invoice #{invoice_id} for {amount} is due {due_date}.",
  },
  {
    key: "AfterModuleCreate",
    label: "After module create",
    description: "Notify after a service module create action completes.",
    defaultTemplate: "Hi {client_name}, service #{service_id} is now active.",
  },
  {
    key: "TicketAdminReply",
    label: "Ticket admin reply",
    description: "Notify when an administrator replies to a support ticket.",
    defaultTemplate: "Hi {client_name}, there is a new reply on support ticket #{ticket_id}.",
  },
] as const

export type WhmcsEventKey = (typeof WHMCS_EVENT_DEFINITIONS)[number]["key"]

export interface WhmcsEventConfig {
  enabled: boolean
  template: string
}

export type WhmcsEventsConfig = Record<WhmcsEventKey, WhmcsEventConfig>

export interface WhmcsGeneratorConfig {
  apiUrl: string
  workspaceId: string
  sessionId: string
  optInField: string
  optInValues: string[]
  events: WhmcsEventsConfig
}

export function getDefaultWhmcsEvents(): WhmcsEventsConfig {
  return WHMCS_EVENT_DEFINITIONS.reduce((events, definition) => {
    events[definition.key] = {
      enabled: true,
      template: definition.defaultTemplate,
    }
    return events
  }, {} as WhmcsEventsConfig)
}

function phpString(value: string): string {
  return `'${value
    .replace(/\0/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r\n?/g, "\n")}'`
}

function phpBoolean(value: boolean): string {
  return value ? "true" : "false"
}

function phpStringArray(values: string[]): string {
  return `[${values.map((value) => phpString(value)).join(", ")}]`
}

export function generateWhmcsPhp(config: WhmcsGeneratorConfig): string {
  const apiUrl = config.apiUrl.trim().replace(/\/+$/, "")
  const eventConfig = WHMCS_EVENT_DEFINITIONS.map(
    (definition) => `    ${phpString(definition.key)} => [
      'enabled' => ${phpBoolean(config.events[definition.key].enabled)},
      'template' => ${phpString(config.events[definition.key].template)},
    ],`,
  ).join("\n")

  return String.raw`<?php
declare(strict_types=1);

/**
 * WaSphere WHMCS notifications.
 *
 * Install as: <WHMCS_ROOT>/includes/hooks/wasphere_notifications.php
 * Required environment variables:
 *   WASPHERE_API_URL, WASPHERE_WORKSPACE_ID, WASPHERE_SESSION_ID, WASPHERE_API_KEY
 * WASPHERE_API_URL must match the generated public Dashboard API binding exactly.
 *
 * The API key is intentionally read at runtime and is never stored in this file.
 */

use WHMCS\Database\Capsule;

if (!defined('WHMCS')) {
    exit('This file cannot be accessed directly.');
}

$wasphereConfig = [
    'api_url' => rtrim((string) getenv('WASPHERE_API_URL'), '/'),
    'workspace_id' => trim((string) getenv('WASPHERE_WORKSPACE_ID')),
    'session_id' => trim((string) getenv('WASPHERE_SESSION_ID')),
    'api_key' => trim((string) getenv('WASPHERE_API_KEY')),
    'bound_api_url' => ${phpString(apiUrl)},
    'bound_workspace_id' => ${phpString(config.workspaceId)},
    'bound_session_id' => ${phpString(config.sessionId)},
    'opt_in_field' => ${phpString(config.optInField)},
    'opt_in_values' => ${phpStringArray(config.optInValues)},
    'events' => [
${eventConfig}
    ],
];

if (!class_exists('WASphereWhmcsIntegration', false)) {
    final class WASphereWhmcsIntegration
    {
        private const CONNECT_TIMEOUT_SECONDS = 5;
        private const REQUEST_TIMEOUT_SECONDS = 10;

        public static function register(): void
        {
            $config = self::config();
            foreach (array_keys($config['events'] ?? []) as $event) {
                if (($config['events'][$event]['enabled'] ?? false) !== true) {
                    continue;
                }

                add_hook($event, 1, static function ($vars) use ($event): void {
                    self::handle($event, is_array($vars) ? $vars : []);
                });
            }
        }

        private static function config(): array
        {
            return is_array($GLOBALS['wasphereConfig'] ?? null) ? $GLOBALS['wasphereConfig'] : [];
        }

        private static function handle(string $event, array $vars): void
        {
            $config = self::config();
            if (($config['events'][$event]['enabled'] ?? false) !== true) {
                return;
            }

            if (
                $config['api_url'] === '' ||
                $config['workspace_id'] === '' ||
                $config['session_id'] === '' ||
                $config['api_key'] === ''
            ) {
                self::failure($event, 'missing environment configuration');
                return;
            }

            if (
                $config['api_url'] !== ($config['bound_api_url'] ?? '') ||
                $config['workspace_id'] !== ($config['bound_workspace_id'] ?? '') ||
                $config['session_id'] !== ($config['bound_session_id'] ?? '')
            ) {
                self::failure($event, 'environment binding does not match the generated API URL, workspace, or session');
                return;
            }

            $clientId = self::clientId($vars);
            if ($clientId === null) {
                self::failure($event, 'client could not be identified');
                return;
            }

            if (!self::isOptedIn($clientId, $config)) {
                return;
            }

            $client = self::client($clientId);
            $to = self::normalizePhone(is_object($client) ? ($client->phonenumber ?? '') : '');
            if ($to === null) {
                self::failure($event, 'client phone number is invalid or unavailable');
                return;
            }

            $template = (string) ($config['events'][$event]['template'] ?? '');
            $text = self::render($template, $event, $vars, $client);
            if ($text === '') {
                self::failure($event, 'message template is empty');
                return;
            }

            self::send($event, $to, $text, $config);
        }

        private static function clientId(array $vars): ?int
        {
            $params = is_array($vars['params'] ?? null) ? $vars['params'] : [];
            $ticket = is_array($vars['ticket'] ?? null) ? $vars['ticket'] : [];
            foreach ([
                $vars['clientid'] ?? null,
                $vars['userid'] ?? null,
                $params['clientid'] ?? null,
                $params['userid'] ?? null,
                $ticket['clientid'] ?? null,
                $ticket['userid'] ?? null,
            ] as $candidate) {
                $id = self::positiveInt($candidate);
                if ($id !== null) {
                    return $id;
                }
            }

            return null;
        }

        private static function positiveInt($value): ?int
        {
            if (is_int($value) || (is_string($value) && ctype_digit(trim($value)))) {
                $id = (int) $value;
                return $id > 0 ? $id : null;
            }

            return null;
        }

        private static function client(int $clientId): ?object
        {
            try {
                return Capsule::table('tblclients')->where('id', $clientId)->first();
            } catch (Throwable $error) {
                self::failure('client lookup', 'database lookup failed');
                return null;
            }
        }

        private static function isOptedIn(int $clientId, array $config): bool
        {
            try {
                $value = Capsule::table('tblcustomfields as f')
                    ->join('tblcustomfieldsvalues as v', static function ($join): void {
                        $join->on('v.fieldid', '=', 'f.id');
                    })
                    ->where('f.type', 'client')
                    ->where('f.fieldname', (string) ($config['opt_in_field'] ?? ''))
                    ->where('v.relid', $clientId)
                    ->value('v.value');
            } catch (Throwable $error) {
                self::failure('opt-in check', 'custom field lookup failed');
                return false;
            }

            $normalized = strtolower(trim((string) $value));
            foreach (($config['opt_in_values'] ?? []) as $accepted) {
                if ($normalized !== '' && $normalized === strtolower(trim((string) $accepted))) {
                    return true;
                }
            }

            return false;
        }

        private static function normalizePhone($raw): ?string
        {
            $phone = preg_replace('/\D+/', '', trim((string) $raw));
            if ($phone === null || strpos($phone, '00') === 0) {
                $phone = $phone === null ? '' : substr($phone, 2);
            }

            return preg_match('/^[1-9][0-9]{7,14}$/', $phone) === 1 ? $phone : null;
        }

        private static function render(string $template, string $event, array $vars, ?object $client): string
        {
            $params = is_array($vars['params'] ?? null) ? $vars['params'] : [];
            $ticket = is_array($vars['ticket'] ?? null) ? $vars['ticket'] : [];
            $firstName = is_object($client) ? (string) ($client->firstname ?? '') : '';
            $lastName = is_object($client) ? (string) ($client->lastname ?? '') : '';
            $fullName = trim($firstName . ' ' . $lastName);
            $values = [
                'event' => $event,
                'client_name' => $fullName,
                'first_name' => $firstName,
                'company_name' => is_object($client) ? (string) ($client->companyname ?? '') : '',
                'client_email' => is_object($client) ? (string) ($client->email ?? '') : '',
                'order_id' => self::pick($vars, $params, ['orderid', 'order_id']),
                'invoice_id' => self::pick($vars, $params, ['invoiceid', 'invoice_id']),
                'service_id' => self::pick($vars, $params, ['serviceid', 'service_id']),
                'ticket_id' => self::pick($vars, $ticket, ['ticketid', 'ticket_id']),
                'module' => self::pick($vars, $params, ['module', 'modulename']),
                'amount' => self::pick($vars, $params, ['amount', 'total', 'invoiceamount']),
                'due_date' => self::pick($vars, $params, ['duedate', 'due_date']),
            ];

            $rendered = preg_replace_callback('/\{([a-z_]+)\}/', static function (array $match) use ($values): string {
                return (string) ($values[$match[1]] ?? '');
            }, $template);

            return trim((string) $rendered);
        }

        private static function pick(array $primary, array $secondary, array $keys): string
        {
            foreach ($keys as $key) {
                foreach ([$primary, $secondary] as $source) {
                    if (array_key_exists($key, $source) && is_scalar($source[$key])) {
                        return trim((string) $source[$key]);
                    }
                }
            }

            return '';
        }

        private static function send(string $event, string $to, string $text, array $config): void
        {
            $url = $config['api_url']
                . '/workspaces/' . rawurlencode($config['workspace_id'])
                . '/proxy/api/sessions/' . rawurlencode($config['session_id'])
                . '/messages/text';
            $payload = json_encode(['to' => $to, 'text' => $text], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($payload === false) {
                self::failure($event, 'request body could not be encoded');
                return;
            }

            $curl = curl_init($url);
            if ($curl === false) {
                self::failure($event, 'HTTP client could not be initialized');
                return;
            }

            curl_setopt_array($curl, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $payload,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => self::CONNECT_TIMEOUT_SECONDS,
                CURLOPT_TIMEOUT => self::REQUEST_TIMEOUT_SECONDS,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_HTTPHEADER => [
                    'Accept: application/json',
                    'Content-Type: application/json',
                    'Authorization: Bearer ' . $config['api_key'],
                ],
            ]);

            $response = curl_exec($curl);
            $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
            curl_close($curl);

            if ($response === false) {
                self::failure($event, 'HTTP request failed');
                return;
            }

            if ($status < 200 || $status >= 300) {
                self::failure($event, 'Dashboard API returned HTTP ' . $status);
            }
        }

        private static function failure(string $event, string $reason): void
        {
            logActivity('WaSphere WHMCS integration: ' . $event . ' failed (' . $reason . ').');
        }
    }
}

WASphereWhmcsIntegration::register();
`
}
