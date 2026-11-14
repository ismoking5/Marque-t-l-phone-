export interface CountryOption {
  country: string;
  dialCode: string;
  methods: string[];
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  phone: string;
  withdrawalCountry?: string;
  withdrawalMethod?: string;
  withdrawalAccount?: string;
  withdrawalHolder?: string;
  balance: number;
  totalInvested: number;
  totalEarned: number;
  referralCode: string;
  referredBy?: string;
  referralBonus?: number;
  referralCount?: number;
  role: 'user' | 'admin';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ProjectItem {
  id: string;
  title: string;
  category: string;
  description: string;
  location: string;
  imageUrl: string;
  returnRate: number;
  durationDays: number;
  minInvestment: number;
  dailyIncome: number;
  targetAmount: number;
  raisedAmount: number;
  investorsCount: number;
  status: 'active' | 'paused';
  visibility: 'public' | 'private';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InvestmentItem {
  id: string;
  userId: string;
  userName: string;
  projectId: string;
  projectTitle: string;
  projectCategory: string;
  amount: number;
  dailyIncome: number;
  returnRate: number;
  expectedProfit: number;
  durationDays: number;
  daysCredited: number;
  totalEarnedSoFar: number;
  purchasedAtMs: number;
  status: 'active' | 'completed' | 'expired' | 'cancelled';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'investment'
  | 'payout'
  | 'credit'
  | 'referral'
  | 'gift';

export type TransactionStatus = 'pending' | 'approved' | 'rejected' | 'completed';

export interface TransactionItem {
  id: string;
  userId: string;
  userName: string;
  type: TransactionType;
  amount: number;
  method: string;
  phoneOrAccount: string;
  reference: string;
  status: TransactionStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ReferralItem {
  id: string;
  referrerUid: string;
  referredUid: string;
  referredName: string;
  level?: number;
  commissionEarned: number;
  status: 'active' | 'rewarded';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PlatformSettings {
  id: string;
  referralRate: number;
  minDeposit: number;
  minWithdrawal: number;
  supportPhone: string;
  supportEmail: string;
  adminPhone: string;
  announcement: string;
  allowMultipleSameVip: boolean;
  visibility: 'public';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PhoneAccountRecord {
  key: string;
  password: string;
  profile: UserProfile;
  investments: InvestmentItem[];
  transactions: TransactionItem[];
  referrals: ReferralItem[];
}

export interface PhoneAuthPayload {
  mode: 'login' | 'register';
  country: string;
  dialCode: string;
  phone: string;
  password: string;
  invitationCode: string;
  rememberPassword: boolean;
}
