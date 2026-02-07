#!/bin/bash
set -e
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
cd "$(dirname "$0")"

# Kill any existing validator
pkill -f solana-test-validator 2>/dev/null || true
sleep 1

# Start validator with SPL programs cloned from mainnet
solana-test-validator \
  --bind-address 127.0.0.1 \
  --reset \
  --clone TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  --clone ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL \
  --url https://api.mainnet-beta.solana.com \
  --bpf-program QiAZtS7YfibVDTTarBM8bXfCtPFaMJ24BwSijZHg9W8 target/deploy/claw.so \
  --ledger .anchor/test-ledger \
  > /dev/null 2>&1 &
VALIDATOR_PID=$!

# Wait for validator
echo "Waiting for validator..."
for i in $(seq 1 30); do
  if solana cluster-version -u http://127.0.0.1:8899 > /dev/null 2>&1; then
    echo "Validator ready!"
    break
  fi
  sleep 1
done

# Run tests
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
ANCHOR_WALLET=$HOME/.config/solana/id.json \
NODE_OPTIONS="--no-experimental-strip-types" \
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
TEST_EXIT=$?

# Cleanup
kill $VALIDATOR_PID 2>/dev/null || true
exit $TEST_EXIT
