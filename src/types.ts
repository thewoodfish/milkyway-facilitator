export interface NetworkConfig {
  name: string;
  rpc:  string;
  usdc: string;
}

export interface PaymentAuthorization {
  from:        string;
  to:          string;
  value:       string;
  validAfter:  string;
  validBefore: string;
  nonce:       string;
}

export interface PaymentPayload {
  x402Version: number;
  scheme:      "exact";
  network:     string;
  payload: {
    signature:     string;
    authorization: PaymentAuthorization;
  };
}

export interface VerifyRequest {
  payment:  string;   // base64 encoded PaymentPayload
  resource: string;   // endpoint URL being paid for
  amount:   string;   // expected raw USDC units e.g. "1000000" = 1 USDC
  network:  string;   // e.g. "eip155:42161"
}

export interface VerifyResponse {
  isValid:        boolean;
  invalidReason?: string;
  payer?:         string;
  payee?:         string;
  amount?:        string;
}

export interface SettleRequest {
  payment: string;   // same base64 payload
  network: string;
}

export interface SettleResponse {
  success:  boolean;
  txHash?:  string;
  error?:   string;
}
