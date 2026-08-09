import { hostPlatform } from '../paths.js';
import * as linux from './linux.js';
import * as macos from './macos.js';
import * as windows from './windows.js';

export type ServiceAdapter = {
  enableAndStart: () => void;
  stop: () => void;
  restart: () => void;
  disableAndRemove: () => void;
  isInstalled: () => boolean;
  isActive: () => boolean;
  statusText: () => string;
  name: string;
};

function unsupported(): ServiceAdapter {
  const err = () => {
    throw new Error('OS service management is not supported on this platform');
  };
  return {
    enableAndStart: err,
    stop: err,
    restart: err,
    disableAndRemove: err,
    isInstalled: () => false,
    isActive: () => false,
    statusText: () => 'unsupported platform',
    name: 'none',
  };
}

export function getService(): ServiceAdapter {
  switch (hostPlatform()) {
    case 'linux':
      return {
        enableAndStart: () => {
          if (!linux.isSystemdUserAvailable()) {
            throw new Error('systemd --user is not available');
          }
          linux.enableAndStart();
        },
        stop: linux.stop,
        restart: linux.restart,
        disableAndRemove: linux.disableAndRemove,
        isInstalled: linux.isInstalled,
        isActive: linux.isActive,
        statusText: linux.statusText,
        name: 'systemd-user',
      };
    case 'macos':
      return {
        enableAndStart: macos.enableAndStart,
        stop: macos.stop,
        restart: macos.restart,
        disableAndRemove: macos.disableAndRemove,
        isInstalled: macos.isInstalled,
        isActive: macos.isActive,
        statusText: macos.statusText,
        name: 'launchd',
      };
    case 'windows':
      return {
        enableAndStart: windows.enableAndStart,
        stop: windows.stop,
        restart: windows.restart,
        disableAndRemove: windows.disableAndRemove,
        isInstalled: windows.isInstalled,
        isActive: windows.isActive,
        statusText: windows.statusText,
        name: 'task-scheduler',
      };
    default:
      return unsupported();
  }
}
