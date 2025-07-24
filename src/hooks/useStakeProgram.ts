import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { AnchorProvider } from '@coral-xyz/anchor';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getProgram, getPdaAddress, StakeAccount } from '@/lib/anchor';
import { useToast } from '@/hooks/use-toast';

export const useStakeProgram = () => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, wallet } = useWallet();
  const { toast } = useToast();
  
  const [stakeAccount, setStakeAccount] = useState<StakeAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const provider = useMemo(() => {
    if (!wallet || !publicKey) return null;
    return new AnchorProvider(
      connection,
      wallet.adapter as any,
      { commitment: 'confirmed' }
    );
  }, [connection, wallet, publicKey]);

  const program = useMemo(() => {
    if (!provider) return null;
    return getProgram(provider);
  }, [provider]);

  const [pdaAccount, bump] = useMemo(() => {
    if (!publicKey) return [null, 0];
    return getPdaAddress(publicKey);
  }, [publicKey]);

  const fetchStakeAccount = useCallback(async () => {
    if (!connection || !pdaAccount || !publicKey || !program) return;
    
    setRefreshing(true);
    try {
      const accountInfo = await connection.getAccountInfo(pdaAccount);
      if (accountInfo && accountInfo.data && accountInfo.data.length > 0) {
        // Manually decode the account data based on the struct layout
        // Skip 8-byte discriminator, then read: pubkey(32) + u64(8) + u64(8) + u64(8) + u8(1)
        const data = accountInfo.data;
        if (data.length >= 8 + 32 + 8 + 8 + 8 + 1) {
          let offset = 8; // Skip discriminator
          
          // Owner pubkey (32 bytes)
          const ownerBytes = data.slice(offset, offset + 32);
          const owner = new PublicKey(ownerBytes);
          offset += 32;
          
          // Staked amount (8 bytes, little endian u64)
          const stakedAmountBytes = data.slice(offset, offset + 8);
          const stakedAmount = new BN(stakedAmountBytes, 'le').toNumber();
          offset += 8;
          
          // Total points (8 bytes, little endian u64)
          const totalPointsBytes = data.slice(offset, offset + 8);
          const totalPoints = new BN(totalPointsBytes, 'le').toNumber();
          offset += 8;
          
          // Last updated time (8 bytes, little endian u64)
          const lastUpdatedTimeBytes = data.slice(offset, offset + 8);
          const lastUpdatedTime = new BN(lastUpdatedTimeBytes, 'le').toNumber();
          offset += 8;
          
          // Bump (1 byte)
          const bump = data[offset];
          
          setStakeAccount({
            owner,
            stakedAmount,
            totalPoints,
            lastUpdatedTime,
            bump,
          });
        } else {
          setStakeAccount(null);
        }
      } else {
        setStakeAccount(null);
      }
    } catch (error) {
      console.log('Account not found or not initialized');
      setStakeAccount(null);
    } finally {
      setRefreshing(false);
    }
  }, [connection, pdaAccount, publicKey, program]);

  const createPdaAccount = useCallback(async () => {
    if (!program || !publicKey || !pdaAccount) return;
    
    setLoading(true);
    try {
      const tx = await program.methods
        .createPdaAccount()
        .accounts({
          payer: publicKey,
          pdaAccount: pdaAccount,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      toast({
        title: "Account Created",
        description: "Your staking account has been created successfully!",
      });
      
      await fetchStakeAccount();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create account",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, pdaAccount, toast, fetchStakeAccount]);

  const stake = useCallback(async (amount: number) => {
    if (!program || !publicKey || !pdaAccount || amount <= 0) return;
    
    setLoading(true);
    try {
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
      const tx = await program.methods
        .stake(new BN(lamports))
        .accounts({
          user: publicKey,
          pdaAccount: pdaAccount,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      toast({
        title: "Staked Successfully",
        description: `Staked ${amount} SOL successfully!`,
      });
      
      await fetchStakeAccount();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to stake",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, pdaAccount, toast, fetchStakeAccount]);

  const unstake = useCallback(async (amount: number) => {
    if (!program || !publicKey || !pdaAccount || amount <= 0) return;
    
    setLoading(true);
    try {
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
      const tx = await program.methods
        .unstake(new BN(lamports))
        .accounts({
          user: publicKey,
          pdaAccount: pdaAccount,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      toast({
        title: "Unstaked Successfully",
        description: `Unstaked ${amount} SOL successfully!`,
      });
      
      await fetchStakeAccount();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to unstake",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, pdaAccount, toast, fetchStakeAccount]);

  const claimPoints = useCallback(async () => {
    if (!program || !publicKey || !pdaAccount) return;
    
    setLoading(true);
    try {
      const tx = await program.methods
        .claimPoints()
        .accounts({
          user: publicKey,
          pdaAccount: pdaAccount,
        })
        .rpc();
      
      const claimablePoints = stakeAccount ? Math.floor(stakeAccount.totalPoints / 1_000_000) : 0;
      
      toast({
        title: "Points Claimed",
        description: `Claimed ${claimablePoints} points successfully!`,
      });
      
      await fetchStakeAccount();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to claim points",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, pdaAccount, toast, stakeAccount, fetchStakeAccount]);

  useEffect(() => {
    fetchStakeAccount();
  }, [fetchStakeAccount]);

  const stakedSOL = stakeAccount ? stakeAccount.stakedAmount / LAMPORTS_PER_SOL : 0;
  const claimablePoints = stakeAccount ? Math.floor(stakeAccount.totalPoints / 1_000_000) : 0;
  const isAccountInitialized = !!stakeAccount;

  return {
    stakeAccount,
    stakedSOL,
    claimablePoints,
    isAccountInitialized,
    loading,
    refreshing,
    createPdaAccount,
    stake,
    unstake,
    claimPoints,
    fetchStakeAccount,
  };
};