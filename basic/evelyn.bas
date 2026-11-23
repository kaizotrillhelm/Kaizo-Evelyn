' evelyn.bas - Evelyn in a terminal (BASIC edition, FreeBASIC -lang qb).
' Build: fbc -lang qb evelyn.bas      Run: evelyn [TINY.BIN] [book.txt]
' Keeps USER.CFG (profile) and LIBRARY.EVL (library) in the current folder.
' Commands: /mode R|A|D|M   /adv   /code <lines separated by ;>   /profile   /quit
' Anything else is a question.

#include "evelyn_decl.bi"
#include "evelyn_core.bi"
#include "evelyn_data.bi"
#include "evelyn_io.bi"

DIM sLine AS STRING, sText AS STRING, sArgs AS STRING, sFile AS STRING, iSp AS INTEGER, iInAdv AS INTEGER
DIM iRc AS INTEGER, iN AS INTEGER, lE AS LONG, lC AS LONG, lP AS LONG, sCode AS STRING, iI AS INTEGER

CALL PmReset
CALL LoadRooms
CALL RngSeed(0#)
CALL LibClear
sText = ReadFileText$("LIBRARY.EVL")
iN = 0
IF gFileOk THEN iN = LibFromText%(sText)
IF iN = 0 THEN
    CALL LoadStarterPack
    CALL WriteFileText("LIBRARY.EVL", LibToText$())
END IF
sText = ReadFileText$("USER.CFG")
IF gFileOk THEN CALL PmFromCfg(sText)

' optional files on the command line: a .BIN is the neural net, anything else is a book
sArgs = TrimWs$(COMMAND$)
DO WHILE LEN(sArgs) > 0
    iSp = INSTR(sArgs, " ")
    IF iSp = 0 THEN
        sFile = sArgs
        sArgs = ""
    ELSE
        sFile = LEFT$(sArgs, iSp - 1)
        sArgs = TrimWs$(MID$(sArgs, iSp + 1))
    END IF
    IF UCASE$(RIGHT$(sFile, 4)) = ".BIN" THEN
        iRc = LoadTinyBin%(sFile)
        IF iRc = 0 THEN
            PRINT "Loaded TNY2: D=" + IntStr$(CLNG(gTD)) + " L=" + IntStr$(CLNG(gTL)) + " H=" + IntStr$(CLNG(gTH)) + " HID=" + IntStr$(CLNG(gHID))
        ELSE
            PRINT sFile + " is not a usable TNY2 file (code " + IntStr$(CLNG(iRc)) + ")"
        END IF
    ELSE
        sText = ReadFileText$(sFile)
        IF gFileOk THEN
            iN = LibIngest%(sText, sFile)
            CALL WriteFileText("LIBRARY.EVL", LibToText$())
            PRINT "Imported " + IntStr$(CLNG(iN)) + " chunks from " + sFile
        ELSE
            PRINT "Cannot read " + sFile
        END IF
    END IF
LOOP

CALL LibStats(lE, lC)
PRINT "EVELYN (BASIC) | learner: " + gPmName + " | mode " + gPmMode + " | xp " + IntStr$(gPmXp) + " | library entries: " + IntStr$(lE)
PRINT "Commands: /mode R|A|D|M  /adv  /code <lines separated by ;>  /profile  /quit  or ask a question"
iInAdv = 0
DO
    PRINT "> ";
    LINE INPUT sLine
    sLine = TrimWs$(sLine)
    IF sLine = "/quit" THEN EXIT DO
    IF LEFT$(sLine, 6) = "/mode " THEN
        PRINT "Mode -> " + PmSetMode$(MID$(sLine, 7))
    ELSEIF sLine = "/adv" THEN
        iInAdv = NOT iInAdv
        IF iInAdv THEN PRINT AdvLook$() ELSE PRINT "Back to the tutor."
    ELSEIF sLine = "/profile" THEN
        PRINT PmToCfg$();
    ELSEIF LEFT$(sLine, 6) = "/code " THEN
        sCode = ""
        FOR lP = 7 TO LEN(sLine)
            IF MID$(sLine, lP, 1) = ";" THEN sCode = sCode + CHR$(10) ELSE sCode = sCode + MID$(sLine, lP, 1)
        NEXT lP
        CALL SbRun(sCode)
        IF gRunOk THEN
            FOR iI = 0 TO gOutN - 1
                PRINT aOut(iI)
            NEXT iI
            PRINT gGrid
        ELSE
            PRINT "Error: " + gRunErr
        END IF
    ELSEIF iInAdv THEN
        PRINT AdvCommand$(sLine)
    ELSEIF LEN(sLine) > 0 THEN
        sText = TutorAsk$(sLine)
        PRINT sText
        PRINT "[" + gTutSource + "]"
    END IF
LOOP
CALL WriteFileText("USER.CFG", PmToCfg$())
END
