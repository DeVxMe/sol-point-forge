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
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [calculatedPoints, setCalculatedPoints] = useState<number>(0);

//   use this and give the users the points balance in form of solana such that 10000 points = 1 solana from this account
// console.log(import.meta.env.VITE_POINTS_ACCOUNT_PRIVATE_KEY)

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

  // Helper to calculate points based on staked amount and time elapsed
  const calculatePoints = (stakedAmount: number, lastUpdatedTime: number, totalPoints: number) => {
    // If nothing staked, just return totalPoints
    if (!stakedAmount || !lastUpdatedTime) return totalPoints;
    const now = Math.floor(Date.now() / 1000);
    const timeElapsed = now - lastUpdatedTime;
    // You may need to adjust this formula to match your backend logic
    // For example, 1 point per SOL per second, scaled by 1_000_000
    // If your backend uses a different rate, update accordingly
    const pointsEarned = Math.floor((stakedAmount * timeElapsed) / LAMPORTS_PER_SOL);
    // If your backend multiplies by 1_000_000, do the same here
    // But since you divide by 1_000_000 for display, just add directly
    return totalPoints + pointsEarned * 1_000_000;
  };

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
          
          // Calculate claimable points including unclaimed points since last update
          const now = Math.floor(Date.now() / 1000);
          const timeElapsed = now - lastUpdatedTime;
          let pointsEarned = 0;
          if (stakedAmount > 0 && timeElapsed > 0) {
            // This formula should match your backend's points accrual logic
            // For example, 1 point per SOL per second, scaled by 1_000_000
            pointsEarned = Math.floor((stakedAmount * timeElapsed) / LAMPORTS_PER_SOL) * 1_000_000;
          }
          const totalClaimablePoints = totalPoints + pointsEarned;

          setCalculatedPoints(totalClaimablePoints);

          console.log('Stake Account Data:', {
            owner: owner.toString(),
            stakedAmount: stakedAmount / LAMPORTS_PER_SOL,
            totalPoints,
            lastUpdatedTime: new Date(lastUpdatedTime * 1000),
            currentTime: new Date(),
            timeElapsed: (Date.now() / 1000) - lastUpdatedTime,
            bump,
            pointsEarned,
            totalClaimablePoints,
          });
          
          setStakeAccount({
            owner,
            stakedAmount,
            totalPoints,
            lastUpdatedTime,
            bump,
          });
        } else {
          setStakeAccount(null);
          setCalculatedPoints(0);
        }
      } else {
        setStakeAccount(null);
        setCalculatedPoints(0);
      }
    } catch (error) {
      console.log('Account not found or not initialized');
      setStakeAccount(null);
      setCalculatedPoints(0);
    } finally {
      setRefreshing(false);
    }
  }, [connection, pdaAccount, publicKey, program]);

  const fetchWalletBalance = useCallback(async () => {
    if (!connection || !publicKey) return;
    
    try {
      const balance = await connection.getBalance(publicKey);
      setWalletBalance(balance / LAMPORTS_PER_SOL);
    } catch (error) {
      console.log('Failed to fetch wallet balance:', error);
      setWalletBalance(0);
    }
  }, [connection, publicKey]);

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
      await fetchWalletBalance();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create account",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, pdaAccount, toast, fetchStakeAccount, fetchWalletBalance]);

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
      await fetchWalletBalance();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to stake",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, pdaAccount, toast, fetchStakeAccount, fetchWalletBalance]);

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
      await fetchWalletBalance();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to unstake",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, pdaAccount, toast, fetchStakeAccount, fetchWalletBalance]);

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
      
      // After claiming, fetchStakeAccount will update calculatedPoints
      toast({
        title: "Points Claimed",
        description: `Claimed ${Math.floor(calculatedPoints / 1_000_000)} points successfully!`,
      });
      
      await fetchStakeAccount();
      await fetchWalletBalance();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to claim points",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, pdaAccount, toast, calculatedPoints, fetchStakeAccount, fetchWalletBalance]);

  useEffect(() => {
    fetchStakeAccount();
    fetchWalletBalance();
    // Set up an interval to update points in real time (every second)
    const interval = setInterval(() => {
      if (stakeAccount) {
        const { stakedAmount, lastUpdatedTime, totalPoints } = stakeAccount;
        const now = Math.floor(Date.now() / 1000);
        const timeElapsed = now - lastUpdatedTime;
        let pointsEarned = 0;
        if (stakedAmount > 0 && timeElapsed > 0) {
          pointsEarned = Math.floor((stakedAmount * timeElapsed) / LAMPORTS_PER_SOL) * 1_000_000;
        }
        setCalculatedPoints(totalPoints + pointsEarned);
      }
    }, 1000);

    // Set up an interval to refresh points from the backend every 20 seconds
    const refreshInterval = setInterval(() => {
      fetchStakeAccount();
    }, 20000);

    return () => {
      clearInterval(interval);
      clearInterval(refreshInterval);
    };
  }, [fetchStakeAccount, fetchWalletBalance, stakeAccount]);

  const stakedSOL = stakeAccount ? stakeAccount.stakedAmount / LAMPORTS_PER_SOL : 0;
  // Use calculatedPoints for display, not just the on-chain totalPoints
  const claimablePoints = Math.floor(calculatedPoints / 1_000_000);
  const isAccountInitialized = !!stakeAccount;

  return {
    stakeAccount,
    walletBalance,
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
    fetchWalletBalance,
  };
};
