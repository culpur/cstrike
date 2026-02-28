#!/usr/bin/env python3
"""
Test script for new API endpoints
Tests Configuration and Results management endpoints
"""

import requests
import json
from pathlib import Path

BASE_URL = "http://localhost:8000/api/v1"


def test_get_config():
    """Test GET /api/v1/config"""
    print("\n=== Testing GET /api/v1/config ===")
    try:
        response = requests.get(f"{BASE_URL}/config")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            config = response.json()
            print("Configuration retrieved successfully:")
            print(json.dumps(config, indent=2))
            # Verify secrets are masked
            if config.get('openai_api_key', '').endswith('...'):
                print("✓ API key is masked")
            if config.get('msf_password') == '***':
                print("✓ MSF password is masked")
            return True
        else:
            print(f"Error: {response.text}")
            return False
    except Exception as e:
        print(f"Exception: {e}")
        return False


def test_update_config():
    """Test PUT /api/v1/config"""
    print("\n=== Testing PUT /api/v1/config ===")
    try:
        # First get current config
        response = requests.get(f"{BASE_URL}/config")
        if response.status_code != 200:
            print("Failed to get current config")
            return False

        config = response.json()

        # Update a non-sensitive field
        config['max_threads'] = 15

        # Update config
        response = requests.put(f"{BASE_URL}/config", json=config)
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            result = response.json()
            print("Configuration updated successfully:")
            print(json.dumps(result, indent=2))

            # Verify the change
            response = requests.get(f"{BASE_URL}/config")
            updated_config = response.json()
            if updated_config.get('max_threads') == 15:
                print("✓ Configuration change verified")
                return True
            else:
                print("✗ Configuration change not persisted")
                return False
        else:
            print(f"Error: {response.text}")
            return False
    except Exception as e:
        print(f"Exception: {e}")
        return False


def test_get_all_results():
    """Test GET /api/v1/results"""
    print("\n=== Testing GET /api/v1/results ===")
    try:
        response = requests.get(f"{BASE_URL}/results")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"Found {data.get('count', 0)} targets with results:")
            for target in data.get('targets', []):
                print(f"  - {target.get('target')}: {target.get('status')}")
                print(f"    Loot count: {target.get('loot_count', 0)}")
                print(f"    Results available: {target.get('results_available', False)}")
            return True
        else:
            print(f"Error: {response.text}")
            return False
    except Exception as e:
        print(f"Exception: {e}")
        return False


def test_get_target_results():
    """Test GET /api/v1/results/<target>"""
    print("\n=== Testing GET /api/v1/results/culpur.net ===")
    try:
        response = requests.get(f"{BASE_URL}/results/culpur.net")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            results = response.json()
            print("Target results retrieved successfully:")
            print(f"  Target: {results.get('target')}")
            print(f"  Ports found: {len(results.get('ports', []))}")
            print(f"  Subdomains found: {len(results.get('subdomains', []))}")
            print(f"  Vulnerabilities found: {len(results.get('vulnerabilities', []))}")
            if 'loot' in results:
                print(f"  Loot categories: {list(results['loot'].keys())}")
            return True
        else:
            print(f"Error: {response.text}")
            return False
    except Exception as e:
        print(f"Exception: {e}")
        return False


def test_download_json():
    """Test GET /api/v1/results/<target>/download?format=json"""
    print("\n=== Testing GET /api/v1/results/culpur.net/download?format=json ===")
    try:
        response = requests.get(f"{BASE_URL}/results/culpur.net/download?format=json")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print(f"Content-Type: {response.headers.get('Content-Type')}")
            print(f"Content-Disposition: {response.headers.get('Content-Disposition')}")
            # Verify it's valid JSON
            try:
                data = response.json()
                print(f"✓ Valid JSON received with {len(data)} top-level keys")
                return True
            except:
                print("✗ Invalid JSON received")
                return False
        else:
            print(f"Error: {response.text}")
            return False
    except Exception as e:
        print(f"Exception: {e}")
        return False


def test_download_markdown():
    """Test GET /api/v1/results/<target>/download?format=markdown"""
    print("\n=== Testing GET /api/v1/results/culpur.net/download?format=markdown ===")
    try:
        response = requests.get(f"{BASE_URL}/results/culpur.net/download?format=markdown")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print(f"Content-Type: {response.headers.get('Content-Type')}")
            print(f"Content-Disposition: {response.headers.get('Content-Disposition')}")
            # Verify it's markdown
            content = response.text
            if content.startswith("# Scan Report:"):
                print(f"✓ Valid Markdown report received ({len(content)} chars)")
                print("\nFirst 500 chars of report:")
                print(content[:500])
                return True
            else:
                print("✗ Invalid Markdown format")
                return False
        else:
            print(f"Error: {response.text}")
            return False
    except Exception as e:
        print(f"Exception: {e}")
        return False


def test_validation_errors():
    """Test error handling and validation"""
    print("\n=== Testing Validation and Error Handling ===")
    tests_passed = 0

    # Test 1: Update config with missing required field
    print("\n1. Testing missing required field:")
    try:
        response = requests.put(f"{BASE_URL}/config", json={
            "allowed_tools": ["nmap"],
            "scan_modes": ["port"]
            # Missing max_threads and max_runtime
        })
        if response.status_code == 400 and 'Missing required field' in response.text:
            print("✓ Correctly rejected incomplete config")
            tests_passed += 1
        else:
            print("✗ Did not reject incomplete config properly")
    except Exception as e:
        print(f"Exception: {e}")

    # Test 2: Get results for non-existent target
    print("\n2. Testing non-existent target:")
    try:
        response = requests.get(f"{BASE_URL}/results/nonexistent.target")
        if response.status_code == 404:
            print("✓ Correctly returned 404 for missing target")
            tests_passed += 1
        else:
            print("✗ Did not return 404 for missing target")
    except Exception as e:
        print(f"Exception: {e}")

    # Test 3: Download with invalid format
    print("\n3. Testing invalid download format:")
    try:
        response = requests.get(f"{BASE_URL}/results/culpur.net/download?format=invalid")
        if response.status_code == 400 and 'Invalid format' in response.text:
            print("✓ Correctly rejected invalid format")
            tests_passed += 1
        else:
            print("✗ Did not reject invalid format properly")
    except Exception as e:
        print(f"Exception: {e}")

    return tests_passed == 3


def main():
    """Run all tests"""
    print("=" * 60)
    print("Testing New API Endpoints")
    print("=" * 60)
    print("\nMake sure the API server is running on http://localhost:8000")
    print("Press Enter to continue or Ctrl+C to cancel...")
    input()

    results = {
        'GET /api/v1/config': test_get_config(),
        'PUT /api/v1/config': test_update_config(),
        'GET /api/v1/results': test_get_all_results(),
        'GET /api/v1/results/<target>': test_get_target_results(),
        'Download JSON': test_download_json(),
        'Download Markdown': test_download_markdown(),
        'Validation & Errors': test_validation_errors()
    }

    print("\n" + "=" * 60)
    print("Test Results Summary")
    print("=" * 60)

    passed = sum(1 for result in results.values() if result)
    total = len(results)

    for test_name, result in results.items():
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status} - {test_name}")

    print("\n" + "=" * 60)
    print(f"Overall: {passed}/{total} tests passed")
    print("=" * 60)

    return passed == total


if __name__ == '__main__':
    import sys
    success = main()
    sys.exit(0 if success else 1)
