"""
Credential Validator Module
Tests discovered credentials against target services (SSH, HTTP, FTP, RDP)
"""

import logging
import socket
import paramiko
import ftplib
import requests
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Tuple
from requests.auth import HTTPBasicAuth

# Timeout for connection attempts (seconds)
CONNECTION_TIMEOUT = 10


class CredentialValidator:
    """Validates credentials against various service types"""

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        # Suppress paramiko logging noise
        logging.getLogger("paramiko").setLevel(logging.WARNING)

    def validate(
        self,
        credential_id: str,
        target: str,
        username: str,
        password: str,
        service: str,
        port: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Validate a credential against a target service

        Args:
            credential_id: Unique identifier for the credential
            target: Target host (IP or hostname)
            username: Username to test
            password: Password to test
            service: Service type (ssh, http, ftp, rdp, smb)
            port: Optional port override

        Returns:
            Dictionary with validation results
        """
        self.logger.info(f"Validating credential {credential_id} for {service}://{username}@{target}")

        # Determine validation method based on service
        validators = {
            'ssh': self._validate_ssh,
            'http': self._validate_http,
            'https': self._validate_http,
            'ftp': self._validate_ftp,
            'rdp': self._validate_rdp,
            'smb': self._validate_smb,
        }

        service_lower = service.lower()
        validator = validators.get(service_lower)

        if not validator:
            return {
                'credential_id': credential_id,
                'valid': False,
                'service': service,
                'target': target,
                'username': username,
                'tested_at': datetime.now(timezone.utc).isoformat(),
                'error': f'Unsupported service type: {service}',
                'details': None
            }

        try:
            is_valid, details, error = validator(target, username, password, port)

            return {
                'credential_id': credential_id,
                'valid': is_valid,
                'service': service,
                'target': target,
                'username': username,
                'tested_at': datetime.now(timezone.utc).isoformat(),
                'error': error,
                'details': details
            }
        except Exception as e:
            self.logger.error(f"Validation error for {credential_id}: {e}")
            return {
                'credential_id': credential_id,
                'valid': False,
                'service': service,
                'target': target,
                'username': username,
                'tested_at': datetime.now(timezone.utc).isoformat(),
                'error': str(e),
                'details': None
            }

    def _validate_ssh(
        self,
        target: str,
        username: str,
        password: str,
        port: Optional[int] = None
    ) -> Tuple[bool, Optional[Dict], Optional[str]]:
        """Validate SSH credentials"""
        port = port or 22

        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            client.connect(
                hostname=target,
                port=port,
                username=username,
                password=password,
                timeout=CONNECTION_TIMEOUT,
                allow_agent=False,
                look_for_keys=False
            )

            # Try to execute a simple command to verify full access
            stdin, stdout, stderr = client.exec_command('whoami')
            whoami_output = stdout.read().decode().strip()

            client.close()

            return (
                True,
                {
                    'port': port,
                    'protocol': 'ssh',
                    'access_level': 'full',
                    'whoami': whoami_output
                },
                None
            )

        except paramiko.AuthenticationException:
            return (False, None, 'Authentication failed')
        except paramiko.SSHException as e:
            return (False, None, f'SSH error: {str(e)}')
        except socket.timeout:
            return (False, None, 'Connection timeout')
        except socket.error as e:
            return (False, None, f'Connection error: {str(e)}')
        except Exception as e:
            return (False, None, f'Unexpected error: {str(e)}')

    def _validate_http(
        self,
        target: str,
        username: str,
        password: str,
        port: Optional[int] = None
    ) -> Tuple[bool, Optional[Dict], Optional[str]]:
        """Validate HTTP/HTTPS Basic Auth credentials"""
        # Determine scheme and default port
        if target.startswith('https://'):
            scheme = 'https'
            default_port = 443
            target_clean = target.replace('https://', '')
        elif target.startswith('http://'):
            scheme = 'http'
            default_port = 80
            target_clean = target.replace('http://', '')
        else:
            # Assume HTTP if no scheme
            scheme = 'http'
            default_port = 80
            target_clean = target

        port = port or default_port

        # Remove port if included in target
        if ':' in target_clean:
            target_clean = target_clean.split(':')[0]

        url = f"{scheme}://{target_clean}:{port}/"

        try:
            # Try authentication with Basic Auth
            response = requests.get(
                url,
                auth=HTTPBasicAuth(username, password),
                timeout=CONNECTION_TIMEOUT,
                verify=False,  # Allow self-signed certs
                allow_redirects=True
            )

            # Consider 200-299 as successful authentication
            # 401/403 means auth failed
            # Other codes might indicate service-specific behavior
            if response.status_code < 400:
                return (
                    True,
                    {
                        'port': port,
                        'protocol': scheme,
                        'status_code': response.status_code,
                        'url': url
                    },
                    None
                )
            elif response.status_code == 401:
                return (False, None, 'Authentication failed (401 Unauthorized)')
            elif response.status_code == 403:
                return (False, None, 'Access forbidden (403 Forbidden)')
            else:
                return (
                    False,
                    None,
                    f'Unexpected status code: {response.status_code}'
                )

        except requests.exceptions.Timeout:
            return (False, None, 'Connection timeout')
        except requests.exceptions.ConnectionError as e:
            return (False, None, f'Connection error: {str(e)}')
        except Exception as e:
            return (False, None, f'Unexpected error: {str(e)}')

    def _validate_ftp(
        self,
        target: str,
        username: str,
        password: str,
        port: Optional[int] = None
    ) -> Tuple[bool, Optional[Dict], Optional[str]]:
        """Validate FTP credentials"""
        port = port or 21

        try:
            ftp = ftplib.FTP(timeout=CONNECTION_TIMEOUT)
            ftp.connect(target, port)

            # Try to login
            welcome = ftp.login(username, password)

            # Try to list directory to verify access
            files = []
            ftp.retrlines('LIST', files.append)

            ftp.quit()

            return (
                True,
                {
                    'port': port,
                    'protocol': 'ftp',
                    'welcome': welcome,
                    'file_count': len(files)
                },
                None
            )

        except ftplib.error_perm as e:
            error_msg = str(e)
            if '530' in error_msg:
                return (False, None, 'Authentication failed')
            return (False, None, f'FTP error: {error_msg}')
        except socket.timeout:
            return (False, None, 'Connection timeout')
        except socket.error as e:
            return (False, None, f'Connection error: {str(e)}')
        except Exception as e:
            return (False, None, f'Unexpected error: {str(e)}')

    def _validate_rdp(
        self,
        target: str,
        username: str,
        password: str,
        port: Optional[int] = None
    ) -> Tuple[bool, Optional[Dict], Optional[str]]:
        """
        Validate RDP credentials
        Note: Full RDP validation requires additional dependencies (rdpy, freerdp)
        This implementation does basic port checking and would need enhancement
        """
        port = port or 3389

        try:
            # Basic connectivity check
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(CONNECTION_TIMEOUT)
            result = sock.connect_ex((target, port))
            sock.close()

            if result != 0:
                return (False, None, f'RDP port {port} not reachable')

            # Note: Actual credential validation for RDP requires rdpy or xfreerdp
            # This is a placeholder that confirms port accessibility
            return (
                False,
                None,
                'RDP credential validation requires additional tools (rdpy/xfreerdp)'
            )

        except socket.timeout:
            return (False, None, 'Connection timeout')
        except Exception as e:
            return (False, None, f'Unexpected error: {str(e)}')

    def _validate_smb(
        self,
        target: str,
        username: str,
        password: str,
        port: Optional[int] = None
    ) -> Tuple[bool, Optional[Dict], Optional[str]]:
        """
        Validate SMB credentials
        Note: Full SMB validation requires smbclient or pysmb
        This is a placeholder implementation
        """
        port = port or 445

        try:
            # Basic connectivity check
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(CONNECTION_TIMEOUT)
            result = sock.connect_ex((target, port))
            sock.close()

            if result != 0:
                return (False, None, f'SMB port {port} not reachable')

            # Note: Actual credential validation for SMB requires pysmb or smbclient
            return (
                False,
                None,
                'SMB credential validation requires additional tools (pysmb/smbclient)'
            )

        except socket.timeout:
            return (False, None, 'Connection timeout')
        except Exception as e:
            return (False, None, f'Unexpected error: {str(e)}')


# Singleton instance
validator = CredentialValidator()


def validate_credential(
    credential_id: str,
    target: str,
    username: str,
    password: str,
    service: str,
    port: Optional[int] = None
) -> Dict[str, Any]:
    """
    Convenience function to validate a credential

    Args:
        credential_id: Unique identifier for the credential
        target: Target host (IP or hostname)
        username: Username to test
        password: Password to test
        service: Service type (ssh, http, ftp, rdp, smb)
        port: Optional port override

    Returns:
        Dictionary with validation results
    """
    return validator.validate(credential_id, target, username, password, service, port)


def validate_credentials_batch(credentials: list) -> list:
    """
    Validate multiple credentials

    Args:
        credentials: List of credential dictionaries with keys:
                    credential_id, target, username, password, service, port (optional)

    Returns:
        List of validation result dictionaries
    """
    results = []
    for cred in credentials:
        result = validate_credential(
            credential_id=cred.get('credential_id', ''),
            target=cred.get('target', ''),
            username=cred.get('username', ''),
            password=cred.get('password', ''),
            service=cred.get('service', ''),
            port=cred.get('port')
        )
        results.append(result)

    return results
