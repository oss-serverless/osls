import config from './config.ts';
import create from './create/create.ts';
import install from './install.ts';
import packageModule from './package/package.ts';
import deploy from './deploy.ts';
import invoke from './invoke.ts';
import info from './info.ts';
import logs from './logs.ts';
import metrics from './metrics.ts';
import print from './print.ts';
import remove from './remove.ts';
import rollback from './rollback.ts';
import plugin from './plugin/plugin.ts';
import list from './plugin/list.ts';
import search from './plugin/search.ts';
import configCredentials from './aws/config-credentials.ts';
import provider from './aws/provider.ts';
import common from './aws/common/index.ts';
import packageModule2 from './aws/package/index.ts';
import deploy2 from './aws/deploy/index.ts';
import invoke2 from './aws/invoke.ts';
import info2 from './aws/info/index.ts';
import logs2 from './aws/logs.ts';
import metrics2 from './aws/metrics.ts';
import remove2 from './aws/remove/index.ts';
import rollback2 from './aws/rollback.ts';
import rollbackFunction from './aws/rollback-function.ts';
import deletionProtection from './aws/deletion-protection.ts';
import prune from './aws/prune.ts';
import layers from './aws/package/compile/layers.ts';
import functions from './aws/package/compile/functions.ts';
import schedule from './aws/package/compile/events/schedule.ts';
import s3 from './aws/package/compile/events/s3/index.ts';
import apiGateway from './aws/package/compile/events/api-gateway/index.ts';
import websockets from './aws/package/compile/events/websockets/index.ts';
import sns from './aws/package/compile/events/sns.ts';
import stream from './aws/package/compile/events/stream.ts';
import kafka from './aws/package/compile/events/kafka.ts';
import activemq from './aws/package/compile/events/activemq.ts';
import rabbitmq from './aws/package/compile/events/rabbitmq.ts';
import msk from './aws/package/compile/events/msk/index.ts';
import alb from './aws/package/compile/events/alb/index.ts';
import alexaSkill from './aws/package/compile/events/alexa-skill.ts';
import alexaSmartHome from './aws/package/compile/events/alexa-smart-home.ts';
import iot from './aws/package/compile/events/iot.ts';
import iotFleetProvisioning from './aws/package/compile/events/iot-fleet-provisioning.ts';
import cloudWatchEvent from './aws/package/compile/events/cloud-watch-event.ts';
import cloudWatchLog from './aws/package/compile/events/cloud-watch-log.ts';
import cognitoUserPool from './aws/package/compile/events/cognito-user-pool.ts';
import eventBridge from './aws/package/compile/events/event-bridge/index.ts';
import sqs from './aws/package/compile/events/sqs.ts';
import cloudFront from './aws/package/compile/events/cloud-front.ts';
import httpApi from './aws/package/compile/events/http-api.ts';
import deployFunction from './aws/deploy-function.ts';
import deployList from './aws/deploy-list.ts';
import invokeLocal from './aws/invoke-local/index.ts';

export default [
  config,
  create,
  install,
  packageModule,
  deploy,
  invoke,
  info,
  logs,
  metrics,
  print,
  remove,
  rollback,
  plugin,
  list,
  search,
  configCredentials,
  provider,
  common,
  packageModule2,
  deploy2,
  invoke2,
  info2,
  logs2,
  metrics2,
  remove2,
  rollback2,
  rollbackFunction,
  deletionProtection,
  prune,
  layers,
  functions,
  schedule,
  s3,
  apiGateway,
  websockets,
  sns,
  stream,
  kafka,
  activemq,
  rabbitmq,
  msk,
  alb,
  alexaSkill,
  alexaSmartHome,
  iot,
  iotFleetProvisioning,
  cloudWatchEvent,
  cloudWatchLog,
  cognitoUserPool,
  eventBridge,
  sqs,
  cloudFront,
  httpApi,
  deployFunction,
  deployList,
  invokeLocal,
];
