import { Block } from './block';
import { Transaction } from './transaction';

import shajs from 'sha.js'
import fetch from 'node-fetch';

export class Blockchain {
    private _chain: Block[];
    private _pendingTransactions: Transaction[];
    private _peers: string[]; 
    private _peerUUID: string;

    constructor(peerUUID: string) {
        this._chain = [];
        this._pendingTransactions = [];
        this._peers = [];
        this._peerUUID = peerUUID;
        
        this.addBlock();
    }
    
    public addPeer(peer: string) {
        this._peers.push(peer);
    }

    public get peers() {
        return this._peers;
    }
    
    public checkChainValidity(chain: Block[] = this._chain): boolean {

        // VERIFICAÇÕES NO BLOCO GENESIS

        // o índice deve ser zero
        if (chain[0].index !== 0)
            return false
        
        // hash precisa estar correto
        if (!chain[0].checkSeal())
            return false

        // o bloco deve ter zero transações
        if (chain[0].transactions.length !== 0)
            return false
        
        // VERIFICAÇÕES NOS BLOCOS SUBSEQUENTES

        for (let i = 1; i < chain.length; ++i) {
            // o campo da hash anterior no bloco atual deve ser igual ao
            // campo hash no bloco anterior
            if (chain[i].previousHash !== chain[i - 1].hash)
                return false
            
            // o campo índice do bloco deve conferir com seu índice
            if (chain[i].index !== i)
                return false

            // hash precisa estar correto
            if (!chain[i].checkSeal())
                return false

            // prova de trabalho deve ser válida
            if (!this.checkProofOfWork(chain[i - 1].proof, chain[i].proof, chain[i - 1].hash))
                return false
        }

        return true;
    }

    // TO-DO: Resolvedor de conflitos
    public async resolveConflicts(): Promise<boolean> {
        let newChain: Block[];
        let peerResponses: Promise<any>[] = [];

        for (let peer of this._peers) {
            peerResponses.push(fetch(`http://${peer}/chain`))
        }

        peerResponses = peerResponses.map(p => p.catch(e => e)) // ignora pares que não responderem

        await Promise.all(peerResponses).then(async responses => {
            for (let response of responses) {
                let data = await response.json()

                try {
                    if (!(data.hasOwnProperty('chain') && data.hasOwnProperty('chainLength')))
                        throw new Error('responsePropertyMissing')
                    if (!(data.chainLength > this._chain.length && (newChain === undefined || data.chainLength > newChain.length)))
                        throw new Error('localChainGreaterThanRemote')

                    let candidateChain: Block[] = [];

                    for (let blockData of data.chain) {
                        let block = new Block();
                        block.fromObject(blockData)
                        candidateChain.push(block);
                    }

                    if (!this.checkChainValidity(candidateChain))
                        throw new Error('remoteChainIsInvalid')

                    newChain = candidateChain;

                } catch (e) {} // ignora cadeias inválidas ou menores
            }
        });

        if (newChain !== undefined) {
            this._chain = newChain;
            return true;
        }

        return false;
    }

    // Gera novo bloco
    private addBlock(proof: number = 100): Block {
        
        let newBlock = new Block (
            this._chain.length,
            new Date().toISOString(),
            this._pendingTransactions,
            this._chain.length > 0 ? this._chain[this._chain.length - 1].hash : '1',
            proof
        );

        newBlock.seal();
        
        if (!newBlock.checkSeal())
            throw new Error ('blockSealCheckingFailed')
        if (newBlock.index !== 0 && !this.checkProofOfWork(this._chain[this._chain.length - 1].proof, newBlock.proof, this._chain[this._chain.length - 1].hash))
            throw new Error ('blockProofCheckingFailed')
        
        this._chain.push(newBlock);
        this._pendingTransactions = [];
        return newBlock;
        

    }

    // Registra uma nova transação para ir ao próximo bloco minerado   
    public addTransaction(transaction: Transaction): number {
        this._pendingTransactions.push(transaction);

        return this.lastBlock().index + 1
    }
    
    // Retorna o último bloco minerado
    public lastBlock(): Block {
        return this._chain[this._chain.length - 1];
    }

    // Calcula a prova de trabalho
    private generateProofOfWork(lastBlock: Block): number {
        
        // Algoritmo de Prova de Trabalho
        // Encontre um número p' tal que a hash(p + p') comece com 4 zeros
        // Onde p é a prova anterior, e p' é a nova prova

        let proof = 0;
        let lastProof = lastBlock.proof;
        let lastHash = lastBlock.hash;

        while (!this.checkProofOfWork(lastProof, proof, lastHash))
            ++proof
        
        return proof
    }
    
    // Verifica a prova de trabalho
    private checkProofOfWork(lastProof: number, proof: number, lastHash: string): boolean {
        let data = `${lastProof}${proof}${lastHash}`;
        let hash = shajs('sha256').update(data).digest('hex');
        
        return hash.startsWith('0000')
    }

    // Minera um bloco
    // TO-DO: assíncrono?
    public mine(): Block {

        // Calcula um prova de trabalho para o último bloco
        let lastBlock = this.lastBlock();
        let proof = this.generateProofOfWork(lastBlock);

        // Já que a prova de trabalho foi realizada, receberemos um
        // prêmio: 100 trocados. O remetente é 'mined'.
        let mineTransaction  = new Transaction (
            'mined',
            this._peerUUID,
            100);
        this.addTransaction(mineTransaction)

        // Gera o novo bloco e o adiciona na cadeia
        let newBlock = this.addBlock(proof);

        return newBlock;
    }

    public get chain() {
        return this._chain;
    }

    public get peerUUID() {
        return this._peerUUID;
    }

    public get pendingTransactions() {
        return this._pendingTransactions;
    }

}