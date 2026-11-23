' evelyn_proto.bas - line protocol used by tests/run_conformance.js (BASIC edition).
' Run: evelyn_proto script.txt   (the script path is the command line)
' Prints the same lines as js/evelyn_proto.js for the commands this edition supports.

#include "evelyn_decl.bi"
#include "evelyn_core.bi"
#include "evelyn_data.bi"
#include "evelyn_io.bi"
#include "evelyn_extra.bi"

DECLARE SUB DoCmd (sCmd AS STRING, sArg AS STRING)
DECLARE FUNCTION SplitBar% (sSrc AS STRING, aF() AS STRING)

' splits on "|" into aF(0..4); returns how many fields were given (missing fields are "")
FUNCTION SplitBar% (sSrc AS STRING, aF() AS STRING)
    DIM lStart AS LONG, lBar AS LONG, iN AS INTEGER, iK AS INTEGER
    FOR iK = 0 TO 4
        aF(iK) = ""
    NEXT iK
    iN = 0
    lStart = 1
    DO
        lBar = INSTR(lStart, sSrc, "|")
        IF lBar = 0 THEN
            IF iN < 5 THEN aF(iN) = MID$(sSrc, lStart)
            iN = iN + 1
            EXIT DO
        END IF
        IF iN < 5 THEN aF(iN) = MID$(sSrc, lStart, lBar - lStart)
        iN = iN + 1
        lStart = lBar + 1
    LOOP
    SplitBar% = iN
END FUNCTION

SUB DoCmd (sCmd AS STRING, sArg AS STRING)
    DIM aF(4) AS STRING
    DIM sT AS STRING, sU AS STRING, sB AS STRING, sZ AS STRING, sLine AS STRING
    DIM iI AS INTEGER, iJ AS INTEGER, iN AS INTEGER, iK AS INTEGER, iRc AS INTEGER, iBest AS INTEGER
    DIM lE AS LONG, lC AS LONG, lP AS LONG, lEol AS LONG, lBonus AS LONG
    DIM dSum AS DOUBLE
    DIM aOrd(63) AS INTEGER, aKi(255) AS INTEGER
    DIM dA(255) AS DOUBLE, dB(255) AS DOUBLE

    IF sCmd = "LZ.ENC" THEN
        sT = Unesc$(sArg)
        sZ = LzCompress$(sT)
        IF LEN(sZ) > 0 THEN PRINT "HEX " + HexOf$(sZ) ELSE PRINT "HEX"
        sB = Base64Enc$(sZ)
        IF LEN(sB) > 0 THEN PRINT "B64 " + sB ELSE PRINT "B64"
        sU = LzDecompress$(Base64Dec$(sB))
        PRINT "DEC " + Esc$(sU)
    ELSEIF sCmd = "LZ.DEC" THEN
        sU = LzDecompress$(Unhex$(sArg))
        IF gLzErr THEN PRINT "ERR" ELSE PRINT "DEC " + Esc$(sU)
    ELSEIF sCmd = "B64.ENC" THEN
        PRINT "B64 " + Base64Enc$(Unhex$(sArg))
    ELSEIF sCmd = "B64.DEC" THEN
        sB = Base64Dec$(sArg)
        IF LEN(sB) > 0 THEN PRINT "HEX " + HexOf$(sB) ELSE PRINT "HEX"
    ELSEIF sCmd = "FMT" OR sCmd = "VAL" THEN
        PRINT sCmd + " " + FmtNum$(ValOf#(sArg))
    ELSEIF sCmd = "CLEAN" THEN
        PRINT "TEXT " + Esc$(CleanAscii$(Unesc$(sArg)))
    ELSEIF sCmd = "WORDS" THEN
        CALL Tokenize(Unesc$(sArg))
        sT = "WORDS "
        FOR iI = 0 TO gWordN - 1
            IF iI > 0 THEN sT = sT + " "
            sT = sT + aWord(iI)
        NEXT iI
        PRINT sT

    ELSEIF sCmd = "LIB.CLEAR" THEN
        CALL LibClear
        PRINT "OK"
    ELSEIF sCmd = "LIB.STARTER" THEN
        CALL LoadStarterPack
        CALL LibStats(lE, lC)
        PRINT "ENTRIES " + IntStr$(lE)
    ELSEIF sCmd = "LIB.ADD" THEN
        iN = SplitBar%(Unesc$(sArg), aF())
        iI = LibAdd%(aF(0), aF(1), aF(2), aF(3))
        PRINT "ID " + IntStr$(CLNG(iI))
    ELSEIF sCmd = "LIB.INGEST" THEN
        sT = Unesc$(sArg)
        iI = INSTR(sT, "|")
        iN = LibIngest%(MID$(sT, iI + 1), LEFT$(sT, iI - 1))
        PRINT "CHUNKS " + IntStr$(CLNG(iN))
    ELSEIF sCmd = "LIB.SEARCH" THEN
        sT = Unesc$(sArg)
        iI = INSTR(sT, "|")
        iK = INT(ValOf#(LEFT$(sT, iI - 1)))
        iN = LibSearch%(MID$(sT, iI + 1), iK)
        IF iN = 0 THEN PRINT "NONE"
        FOR iJ = 0 TO iN - 1
            CALL LibRead(aHit(iJ))
            PRINT "HIT " + IntStr$(CLNG(aHit(iJ))) + "|" + Esc$(aLibTopic(aHit(iJ))) + "|" + Esc$(aLibCat(aHit(iJ))) + "|" + Esc$(gRdFact) + "|" + Esc$(gRdEx)
        NEXT iJ
    ELSEIF sCmd = "LIB.STATS" THEN
        CALL LibStats(lE, lC)
        PRINT "ENTRIES " + IntStr$(lE) + " CHARS " + IntStr$(lC)
    ELSEIF sCmd = "LIB.SAVE" THEN
        CALL WriteFileText(sArg, LibToText$())
        PRINT "OK"
    ELSEIF sCmd = "LIB.LOAD" THEN
        sT = ReadFileText$(sArg)
        IF gFileOk = 0 THEN
            PRINT "FAIL"
        ELSE
            iN = LibFromText%(sT)
            IF iN > 0 THEN PRINT "LOADED " + IntStr$(CLNG(iN)) ELSE PRINT "FAIL"
        END IF

    ELSEIF sCmd = "NN.LOAD" THEN
        iRc = LoadTinyBin%(sArg)
        IF iRc = 0 THEN
            PRINT "MODEL D=" + IntStr$(CLNG(gTD)) + " L=" + IntStr$(CLNG(gTL)) + " H=" + IntStr$(CLNG(gTH)) + " HID=" + IntStr$(CLNG(gHID))
        ELSE
            PRINT "ERR"
        END IF
    ELSEIF sCmd = "NN.RESET" THEN
        CALL NetReset
        PRINT "PREFIX 0"
    ELSEIF sCmd = "NN.SEED" THEN
        dSum = INT(ValOf#(sArg))
        CALL RngSeed(dSum)
        PRINT "SEED " + FmtNum$(dSum)
    ELSEIF sCmd = "NN.SCORE" THEN
        sT = CleanAscii$(Unesc$(sArg))
        iJ = 0
        FOR iI = 1 TO LEN(sT)
            IF iJ < CTX - 2 THEN
                IF MID$(sT, iI, 1) = CHR$(10) THEN
                    CALL NetStep(2, iJ)
                ELSE
                    CALL NetStep(ASC(MID$(sT, iI, 1)) - 30, iJ)
                END IF
                iJ = iJ + 1
            END IF
        NEXT iI
        CALL NetStep(1, iJ)
        iBest = 0
        dSum = 0#
        FOR iI = 0 TO VOCAB - 1
            IF aScore(iI) > aScore(iBest) THEN iBest = iI
            dSum = dSum + CDBL(aScore(iI))
        NEXT iI
        PRINT "ARGMAX " + IntStr$(CLNG(iBest))
        sT = "SCORES "
        FOR iI = 0 TO 7
            IF iI > 0 THEN sT = sT + " "
            sT = sT + FmtNum$(CDBL(aScore(iI)))
        NEXT iI
        PRINT sT
        PRINT "SUM " + FmtNum$(dSum)
    ELSEIF sCmd = "NN.THINK" THEN
        sT = Unesc$(sArg)
        iI = INSTR(sT, "|")
        PRINT "OUT " + Esc$(ThinkNet$(MID$(sT, iI + 1), ValOf#(LEFT$(sT, iI - 1))))
    ELSEIF sCmd = "NN.KVSAVE" THEN
        iI = INSTR(sArg, "|")
        sB = KvExport$(CINT(INT(ValOf#(MID$(sArg, iI + 1)))))
        CALL WriteFileBytes(LEFT$(sArg, iI - 1), sB)
        PRINT "KV BYTES " + IntStr$(CLNG(LEN(sB))) + " SUM " + Fnv1a$(sB)
    ELSEIF sCmd = "NN.KVLOAD" THEN
        sT = ReadFileText$(sArg)
        IF gFileOk = 0 THEN
            PRINT "ERR"
        ELSE
            iN = KvImport%(sT)
            IF iN < 0 THEN PRINT "ERR" ELSE PRINT "PREFIX " + IntStr$(CLNG(iN))
        END IF
    ELSEIF sCmd = "NN.PRIME" THEN
        PRINT "PREFIX " + IntStr$(CLNG(NetPrime%(Unesc$(sArg))))

    ELSEIF sCmd = "PM.RESET" THEN
        CALL PmReset
        PRINT "OK"
    ELSEIF sCmd = "PM.MODE" THEN
        PRINT "MODE " + PmSetMode$(sArg)
    ELSEIF sCmd = "PM.SUCCESS" THEN
        sT = Unesc$(sArg)
        iI = INSTR(sT, "|")
        IF iI = 0 THEN
            CALL PmRecord(sT, -1)
        ELSE
            sU = MID$(sT, iI + 1)
            iJ = INSTR(sU, "|")
            IF iJ > 0 THEN sU = LEFT$(sU, iJ - 1)
            lBonus = INT(ValOf#(sU))
            CALL PmRecord(LEFT$(sT, iI - 1), lBonus)
        END IF
        PRINT "XP " + IntStr$(gPmXp)
    ELSEIF sCmd = "PM.BEST" THEN
        PRINT "BEST " + PmBest$()
    ELSEIF sCmd = "PM.CFG" THEN
        sT = PmToCfg$()
        IF RIGHT$(sT, 1) = CHR$(10) THEN sT = LEFT$(sT, LEN(sT) - 1)
        CALL SayLines("CFG", sT)
    ELSEIF sCmd = "PM.SAVE" THEN
        CALL WriteFileText(sArg, PmToCfg$())
        PRINT "OK"
    ELSEIF sCmd = "PM.LOAD" THEN
        sT = ReadFileText$(sArg)
        IF gFileOk = 0 THEN
            PRINT "FAIL"
        ELSE
            CALL PmFromCfg(sT)
            PRINT "LOADED"
        END IF
    ELSEIF sCmd = "FILE.CAT" THEN
        sT = ReadFileText$(sArg)
        IF gFileOk = 0 THEN
            PRINT "NOFILE"
        ELSE
            sU = ""
            FOR lP = 1 TO LEN(sT)
                IF MID$(sT, lP, 1) <> CHR$(13) THEN sU = sU + MID$(sT, lP, 1)
            NEXT lP
            IF RIGHT$(sU, 1) = CHR$(10) THEN sU = LEFT$(sU, LEN(sU) - 1)
            CALL SayLines("FILE", sU)
        END IF

    ELSEIF sCmd = "EXPR" THEN
        CALL SbClearVars
        CALL EvalExpr(Unesc$(sArg))
        IF gRIsStr THEN PRINT "EXPR s:" + Esc$(gRStr) ELSE PRINT "EXPR n:" + FmtNum$(gRNum)
    ELSEIF sCmd = "CODE" THEN
        CALL SbRun(Unesc$(sArg))
        IF gRunOk THEN PRINT "RESULT OK" ELSE PRINT "RESULT ERR"
        IF gRunOk = 0 THEN PRINT "ERROR " + Esc$(gRunErr)
        FOR iI = 0 TO gOutN - 1
            PRINT "OUT " + Esc$(aOut(iI))
        NEXT iI
        IF LEN(gGrid) > 0 THEN CALL SayLines("GRID", gGrid)
        FOR iI = 0 TO gVN - 1
            aOrd(iI) = iI
        NEXT iI
        FOR iI = 0 TO gVN - 2
            FOR iJ = 0 TO gVN - 2 - iI
                IF aVName(aOrd(iJ)) > aVName(aOrd(iJ + 1)) THEN SWAP aOrd(iJ), aOrd(iJ + 1)
            NEXT iJ
        NEXT iI
        FOR iI = 0 TO gVN - 1
            iK = aOrd(iI)
            IF aVIsStr(iK) THEN
                PRINT "VAR " + aVName(iK) + "=s:" + Esc$(aVStr(iK))
            ELSE
                PRINT "VAR " + aVName(iK) + "=n:" + FmtNum$(aVNum(iK))
            END IF
        NEXT iI

    ELSEIF sCmd = "ADV.RESET" THEN
        gPmRoom = "camp"
        gPmInvN = 0
        gPmSolvedN = 0
        PRINT "OK"
    ELSEIF sCmd = "ADV" THEN
        CALL SayLines("ADV", AdvCommand$(Unesc$(sArg)))
    ELSEIF sCmd = "ASK" THEN
        gLastSpoken = ""
        sT = TutorAsk$(Unesc$(sArg))
        CALL SayLines("ASK", sT)
        PRINT "SOURCE " + gTutSource
        PRINT "XP " + IntStr$(gPmXp)
        PRINT "SPOKE " + IntStr$(CLNG(LEN(gLastSpoken)))
        PRINT "MASTERED " + IntStr$(CLNG(gPmMasteredN))
    ELSEIF sCmd = "CHIRP" THEN
        sT = Unesc$(sArg)
        iN = LEN(sT)
        IF iN > 14 THEN iN = 14
        sU = ""
        FOR iI = 1 TO iN
            IF iI > 1 THEN sU = sU + ","
            sU = sU + IntStr$(CLNG(ChirpFreq%(ASC(MID$(sT, iI, 1)))))
        NEXT iI
        PRINT "CHIRP " + IntStr$(CLNG(iN)) + " " + sU
    ELSEIF sCmd = "MS.RESET" THEN
        CALL MsReset
        PRINT "OK"
    ELSEIF sCmd = "MS.ADD" THEN
        iN = SplitBar%(Unesc$(sArg), aF())
        CALL MsAdd(aF(0), aF(1), aF(2), aF(3))
        PRINT "OK"
    ELSEIF sCmd = "MS.ASK" THEN
        sT = Unesc$(sArg)
        iI = INSTR(sT, "|")
        CALL SwarmAsk(MID$(sT, iI + 1), LEFT$(sT, iI - 1))
        CALL SayLines("ANSWER", gSwAnswer)
        PRINT "SOURCES " + Esc$(gSwSources)
        FOR iI = 0 TO gSwChatN - 1
            PRINT "CHAT " + Esc$(aSwChat(iI))
        NEXT iI
    ELSEIF sCmd = "NET.FRAME" THEN
        iN = ParseNums%(sArg, dA())
        FOR iI = iN TO 6
            dA(iI) = 0#
        NEXT iI
        sB = NetPackFrame$(CLNG(dA(0)), dA(1), dA(2), dA(3), dA(4), CLNG(dA(5)), CLNG(dA(6)))
        PRINT "HEX " + HexOf$(sB)
        CALL NetUnpackFrame(sB)
        PRINT "BACK id=" + IntStr$(gNfId) + " x=" + FmtNum$(gNfX) + " y=" + FmtNum$(gNfY) + " vx=" + FmtNum$(gNfVx) + " vy=" + FmtNum$(gNfVy) + " buttons=" + IntStr$(gNfButtons) + " seq=" + IntStr$(gNfSeq)
    ELSEIF sCmd = "NET.BRAIN" THEN
        iN = ParseNums%(sArg, dA())
        sB = NetPackBrain$(dA(), iN)
        PRINT "HEX " + HexOf$(sB)
        iK = NetUnpackBrain%(sB, dB())
        sT = "BACK "
        FOR iI = 0 TO iK - 1
            IF iI > 0 THEN sT = sT + ","
            sT = sT + FmtNum$(dB(iI))
        NEXT iI
        PRINT sT
    ELSEIF sCmd = "QDOT" THEN
        iN = SplitBar%(sArg, aF())
        iJ = ParseNums%(aF(0), dA())
        iK = ParseNums%(aF(1), dB())
        FOR iI = 0 TO iK - 1
            aKi(iI) = CINT(dB(iI))
        NEXT iI
        PRINT "QDOT " + FmtNum$(QuantDot#(dA(), aKi(), 0, ValOf#(aF(2)), iJ))
    ELSE
        PRINT "UNKNOWN " + sCmd
    END IF
END SUB

' ------------------------------------------------------------ main
DIM sScript AS STRING, iFile AS INTEGER, sLine AS STRING, iSp AS INTEGER, sCmd AS STRING, sArg AS STRING

CALL PmReset
CALL LoadRooms
CALL RngSeed(0#)
sScript = TrimWs$(COMMAND$)
iFile = FREEFILE
OPEN sScript FOR INPUT AS #iFile
PRINT "EVELYN-PROTO 1 basic"
DO WHILE NOT EOF(iFile)
    LINE INPUT #iFile, sLine
    IF RIGHT$(sLine, 1) = CHR$(13) THEN sLine = LEFT$(sLine, LEN(sLine) - 1)
    IF LEN(sLine) > 0 THEN
        IF LEFT$(sLine, 1) <> "#" AND LEFT$(sLine, 1) <> "@" THEN
            iSp = INSTR(sLine, " ")
            IF iSp = 0 THEN
                sCmd = sLine
                sArg = ""
            ELSE
                sCmd = LEFT$(sLine, iSp - 1)
                sArg = MID$(sLine, iSp + 1)
            END IF
            IF sCmd = "QUIT" THEN EXIT DO
            PRINT ">> " + sLine
            CALL DoCmd(sCmd, sArg)
        END IF
    END IF
LOOP
CLOSE #iFile
END
